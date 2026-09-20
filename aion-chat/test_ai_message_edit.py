"""Text edits must preserve the transcript and feed the next model context."""
import json
import tempfile
import unittest
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import AsyncMock, patch

import aiosqlite
from fastapi import HTTPException

import context_builder
from routes import chat, chatroom


class AiMessageEditTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.path = Path(temp.name) / 'chat.db'
        async with self.db() as db:
            await db.executescript("""
                CREATE TABLE messages(id TEXT PRIMARY KEY, conv_id TEXT, role TEXT,
                    content TEXT, created_at REAL, attachments TEXT, starred INTEGER);
                CREATE TABLE chatroom_rooms(id TEXT PRIMARY KEY, type TEXT);
                CREATE TABLE chatroom_messages(id TEXT PRIMARY KEY, room_id TEXT, sender TEXT,
                    content TEXT, created_at REAL, attachments TEXT, reasoning_content TEXT);
                INSERT INTO chatroom_rooms VALUES('group','group'),('private','connor_1v1');
            """)
        for target in (chat, chatroom, context_builder):
            p = patch.object(target, 'get_db', self.db)
            p.start()
            self.addCleanup(p.stop)
        for target, name in ((chat.manager, 'broadcast'), (chat, 'export_conversation'),
                             (chatroom, 'broadcast_synced')):
            p = patch.object(target, name, AsyncMock())
            p.start()
            self.addCleanup(p.stop)

    @asynccontextmanager
    async def db(self):
        async with aiosqlite.connect(self.path) as db:
            db.row_factory = aiosqlite.Row
            yield db

    async def insert(self, table, msg_id, room, sender):
        async with self.db() as db:
            await db.execute(f'INSERT INTO {table} VALUES(?,?,?,?,?,?,?)',
                             (msg_id, room, sender, '旧错字', 123,
                              json.dumps([{'type': 'image', 'url': '/keep.png'}]),
                              1 if table == 'messages' else '保留思考'))
            await db.commit()

    async def rows(self, table):
        async with self.db() as db:
            return [dict(r) for r in await (await db.execute(f'SELECT * FROM {table} ORDER BY id')).fetchall()]

    async def test_edits_in_all_chats_preserve_other_fields_and_reach_context(self):
        for table, room, sender, who, route in (
            ('messages', 'main', 'assistant', 'aion', chat),
            ('chatroom_messages', 'group', 'aion', 'aion', chatroom),
            ('chatroom_messages', 'group', 'connor', 'connor', chatroom),
            ('chatroom_messages', 'private', 'connor', 'connor', chatroom),
        ):
            with self.subTest(room=room, sender=sender):
                msg_id = room + sender
                await self.insert(table, msg_id, room, sender)
                await self.insert(table, msg_id + '-later', room, 'user')
                before = await self.rows(table)
                content = '修正后的文本\n\n[HOME:on|不会执行]\n  保留缩进  '
                result = await route.update_message(msg_id, route.MsgUpdate(content=content))
                expected = [{**r, 'content': content} if r['id'] == msg_id else r for r in before]
                self.assertEqual(await self.rows(table), expected)
                self.assertEqual(result['message']['content'], content)
                merged = await context_builder.fetch_merged_timeline(who, 100, conv_id='main')
                saved = next(m for m in merged if m['id'] == msg_id)
                self.assertEqual(saved['content'], content)
                history = context_builder.render_merged_timeline([saved], who)
                self.assertTrue(any('修正后的文本' in m['content'] for m in history))
                self.assertFalse(any('旧错字' in m['content'] for m in history))

    async def test_invalid_edits_leave_messages_unchanged(self):
        for table, route, ai_sender in (('messages', chat, 'assistant'),
                                        ('chatroom_messages', chatroom, 'connor')):
            await self.insert(table, 'ai', 'private', ai_sender)
            await self.insert(table, 'system', 'private', 'system')
            before = await self.rows(table)
            for msg_id, content, status in (('ai', ' \n ', 400), ('missing', '新文本', 404),
                                            ('system', '新文本', 400)):
                with self.subTest(table=table, msg_id=msg_id):
                    with self.assertRaises(HTTPException) as raised:
                        await route.update_message(msg_id, route.MsgUpdate(content=content))
                    self.assertEqual(raised.exception.status_code, status)
                    self.assertEqual(await self.rows(table), before)
