import asyncio
import contextlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import aiosqlite
from fastapi import FastAPI
from fastapi.testclient import TestClient

import capabilities as pat


class PatTests(unittest.TestCase):
    def setUp(self):
        import sqlite3

        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        path = Path(self.temp.name) / 'chat.db'
        with contextlib.closing(sqlite3.connect(path)) as db:
            db.executescript("""
                CREATE TABLE conversations (id TEXT PRIMARY KEY, updated_at REAL);
                CREATE TABLE chatroom_rooms (id TEXT PRIMARY KEY, type TEXT, updated_at REAL);
                CREATE TABLE messages (id TEXT PRIMARY KEY, conv_id TEXT, role TEXT, content TEXT, created_at REAL, attachments TEXT);
                CREATE TABLE chatroom_messages (id TEXT PRIMARY KEY, room_id TEXT, sender TEXT, content TEXT, created_at REAL, attachments TEXT);
                INSERT INTO conversations VALUES ('private', 0);
                INSERT INTO chatroom_rooms VALUES ('group', 'group', 0), ('companion', 'connor_1v1', 0);
            """)
        self.path = path

        @contextlib.asynccontextmanager
        async def get_db():
            async with aiosqlite.connect(path) as db:
                yield db

        self.broadcast = AsyncMock()
        for replacement in (
            patch.object(pat, 'get_db', get_db),
            patch('chatroom.get_chatroom_names', return_value=('Ithi', 'Aion', 'Connor')),
            patch.object(pat.manager, 'broadcast', self.broadcast),
        ):
            replacement.start()
            self.addCleanup(replacement.stop)
        app = FastAPI()
        app.include_router(pat.pat_router)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def send(self, **changes):
        body = dict(scope='chatroom', source_id='group', target='connor', action='拍了拍',
                    suffix='的屁股吓得他一激灵，然后说真翘！！')
        return self.client.post('/api/pat', json={**body, **changes})

    def test_pat_survives_reload_in_all_three_chat_types_and_is_model_visible(self):
        import sqlite3
        from context_builder import _is_model_visible_timeline_message

        for scope, source_id, target, expected_name in (
            ('private', 'private', 'aion', 'Aion'),
            ('chatroom', 'group', 'connor', 'Connor'),
            ('chatroom', 'companion', 'connor', 'Connor'),
        ):
            with self.subTest(source_id=source_id):
                result = self.send(scope=scope, source_id=source_id, target=target)
                self.assertEqual(result.status_code, 200, result.text)
                message = result.json()
                expected = f'「Ithi」拍了拍「{expected_name}」的屁股吓得他一激灵，然后说真翘！！'
                self.assertEqual(message['content'], expected)
                table = 'messages' if scope == 'private' else 'chatroom_messages'
                parent = 'conversations' if scope == 'private' else 'chatroom_rooms'
                with contextlib.closing(sqlite3.connect(self.path)) as db:
                    row = db.execute(f'SELECT content, attachments FROM {table} WHERE id=?', (message['id'],)).fetchone()
                    updated = db.execute(f'SELECT updated_at FROM {parent} WHERE id=?', (source_id,)).fetchone()[0]
                self.assertEqual(row[0], expected)
                self.assertEqual(json.loads(row[1])[0], {
                    'type': 'pat', 'actor': 'user', 'target': target,
                    'action': '拍了拍', 'suffix': '的屁股吓得他一激灵，然后说真翘！！',
                })
                self.assertTrue(_is_model_visible_timeline_message({'sender': 'system', 'content': row[0], 'attachments': row[1]}))
                self.assertGreater(updated, 0)
                self.assertEqual(self.broadcast.call_args.args[0]['data']['id'], message['id'])

    def test_sender_chooses_action_and_current_config_supplies_names(self):
        with patch('chatroom.get_chatroom_names', return_value=('小月', '星星', '小熊')):
            first = self.send(action=' 捏了捏 ', suffix=' 的脸 ').json()
            second = self.send(target='user', action='抱住了', suffix='').json()
        self.assertEqual(first['content'], '「小月」捏了捏「小熊」的脸')
        self.assertEqual(second['content'], '「小月」抱住了自己')
        self.assertNotEqual(first['id'], second['id'])

    def test_invalid_room_target_or_empty_action_cannot_create_notice(self):
        self.assertEqual(self.send(source_id='missing').status_code, 404)
        self.assertEqual(self.send(scope='private', source_id='private').status_code, 400)
        self.assertEqual(self.send(source_id='companion', target='aion').status_code, 400)
        self.assertEqual(self.send(action='   ').status_code, 422)
        self.assertEqual(self.send(suffix='啊' * 201).status_code, 422)
        self.broadcast.assert_not_called()

    def test_both_ai_can_pat_each_other_user_and_self_through_chatroom_processor(self):
        import capabilities
        from routes.chatroom import _process_chatroom_commands

        async def exercise():
            queue = asyncio.Queue()
            for actor, target, expected in (
                ('aion', '「Connor」', '「Aion」拍了拍「Connor」'),
                ('connor', '「Aion」', '「Connor」拍了拍「Aion」'),
                ('connor', '「Ithi」', '「Connor」拍了拍「Ithi」'),
                ('aion', '自己', '「Aion」拍了拍自己'),
            ):
                text, _ = await _process_chatroom_commands(
                    f'好呀。[PAT:拍了拍{target}的狗头，并把煎蛋塞回了Ithi嘴里。]',
                    'group', actor, 'reply-' + actor, queue,
                )
                self.assertEqual(text, '好呀。')
                event = queue.get_nowait()
                self.assertEqual(event['type'], 'system_msg')
                message = event['message']
                self.assertEqual(message['content'], expected + '的狗头，并把煎蛋塞回了Ithi嘴里。')
                self.assertEqual(message['attachments'][0]['actor'], actor)
                order = next(item for item in message['attachments'] if item['type'] == 'system_notice_order')
                self.assertEqual(order['after_msg_id'], 'reply-' + actor)
                self.assertEqual(order['inline_offset'], len('好呀。'))
                self.assertEqual(order['inline_before'], '好呀。')
        with patch.dict(capabilities.SETTINGS, {capabilities.CAPABILITY_SETTINGS_KEY: {'pat': True}}):
            asyncio.run(exercise())

    def test_ai_pat_keeps_its_exact_position_inside_the_reply(self):
        import capabilities
        from capabilities import process_pat_commands

        async def exercise():
            return await process_pat_commands(
                '至于始作俑者——[PAT:捏了捏「Ithi」的怪兽爪子：“软乎乎的。”][心里嘀咕：她还笑得这么开心。]',
                source_type='chatroom', source_id='group', sender='connor',
                source_msg_id='reply-inline',
            )

        with patch.dict(capabilities.SETTINGS, {capabilities.CAPABILITY_SETTINGS_KEY: {'pat': True}}):
            cleaned = asyncio.run(exercise())
        self.assertEqual(cleaned, '至于始作俑者——[心里嘀咕：她还笑得这么开心。]')
        self.assertEqual(self.broadcast.await_count, 1, '自然语言拍拍应保存并推送')
        message = self.broadcast.call_args.args[0]['data']
        self.assertEqual(message['content'], '「Connor」捏了捏「Ithi」的怪兽爪子：“软乎乎的。”')
        order = next(item for item in message['attachments'] if item['type'] == 'system_notice_order')
        self.assertEqual(order, {
            'type': 'system_notice_order',
            'after_msg_id': 'reply-inline',
            'inline_offset': len('至于始作俑者——'),
            'inline_before': '至于始作俑者——',
            'inline_after': '[心里嘀咕：她还笑得这么开心。]',
        })

    def test_autonomy_and_sentinel_parse_wake_pats(self):
        import autonomy
        import capabilities
        import schedule
        from routes import chatroom

        text = '早安。[PAT:轻轻掖好「Ithi」的被角，低头吻了吻额头：“睡吧，我的Ithil。早安先替你收着。”]'

        async def exercise():
            with patch.object(autonomy.manager, 'get_connor_last_active', return_value='companion'), \
                    patch.object(chatroom, '_save_msg', new_callable=AsyncMock) as save:
                await autonomy._save_private_message('connor', text)
                self.assertEqual(save.call_args.args[2], '早安。')
                message = self.broadcast.call_args.args[0]['data']
                self.assertEqual(message['content'], '「Connor」轻轻掖好「Ithi」的被角，低头吻了吻额头：“睡吧，我的Ithil。早安先替你收着。”')
                order = next(a for a in message['attachments'] if a['type'] == 'system_notice_order')
                self.assertEqual(order['after_msg_id'], save.call_args.kwargs['msg_id'])
            self.broadcast.reset_mock()
            cleaned = await schedule._process_background_reply_commands(
                text, target={'type': 'chatroom', 'room_id': 'companion'},
                conv_id=None, sender='connor', ai_msg_id='sentinel-reply',
            )
            self.assertEqual(cleaned, '早安。')
            self.assertEqual(self.broadcast.await_count, 1)

        with patch.dict(capabilities.SETTINGS, {capabilities.CAPABILITY_SETTINGS_KEY: {'pat': True}}):
            asyncio.run(exercise())

    def test_only_first_valid_pat_is_saved_and_history_uses_natural_language(self):
        from capabilities import process_pat_commands
        from context_builder import _pat_history_command

        async def exercise():
            with patch.dict(pat.SETTINGS, {pat.CAPABILITY_SETTINGS_KEY: {'pat': True}}):
                cleaned = await process_pat_commands(
                    '好呀。[PAT:  ][PAT:捏了捏「Ithi」的爪子]过来。[PAT:抱住了「Ithi」]',
                    source_type='chatroom', source_id='group', sender='connor',
                )
            self.assertEqual(cleaned, '好呀。过来。')
            async with pat.get_db() as db:
                rows = await (await db.execute('SELECT content, attachments FROM chatroom_messages')).fetchall()
            self.assertEqual(len(rows), 1)
            content, attachments = rows[0]
            self.assertEqual(content, '「Connor」捏了捏「Ithi」的爪子')
            self.assertEqual(_pat_history_command({'content': content, 'attachments': attachments}),
                             ('connor', '[PAT:捏了捏「Ithi」的爪子]'))

        asyncio.run(exercise())

    def test_autonomy_aion_private_pat_is_removed_before_save(self):
        import autonomy
        import capabilities
        import sqlite3

        async def exercise():
            with patch.object(autonomy, 'get_db', pat.get_db), \
                    patch.object(autonomy, '_latest_conversation', new=AsyncMock(return_value=('private', 'test'))), \
                    patch('routes.files.export_conversation', new_callable=AsyncMock):
                return await autonomy._save_aion_private_message(
                    '[PAT:揉了揉「Ithi」的头]', auto_tts=False,
                )

        with patch.dict(capabilities.SETTINGS, {capabilities.CAPABILITY_SETTINGS_KEY: {'pat': True}}):
            message = asyncio.run(exercise())
        self.assertEqual(message['content'], '')
        with contextlib.closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute('SELECT content FROM messages WHERE id=?', (message['id'],)).fetchone()[0], '')
            self.assertEqual(db.execute("SELECT count(*) FROM messages WHERE role='system'").fetchone()[0], 1)

    def test_next_model_context_keeps_inline_pat_between_reply_fragments(self):
        from context_builder import _merge_inline_pat_notices

        merged = _merge_inline_pat_notices([
            {
                'id': 'pat-inline', 'sender': 'system', 'content': '「Connor」捏住了「Ithi」的脸',
                'attachments': [
                    {'type': 'pat', 'actor': 'connor', 'target': 'user'},
                    {'type': 'system_notice_order', 'after_msg_id': 'reply-inline',
                     'inline_offset': len('至于始作俑者——'), 'inline_before': '至于始作俑者——'},
                ],
            },
            {
                'id': 'reply-inline', 'sender': 'connor',
                'content': '至于始作俑者——[心里嘀咕：她还笑得这么开心。]', 'attachments': [],
            },
        ])
        self.assertEqual(len(merged), 1)
        content = merged[0]['content']
        self.assertNotIn('[系统事件：', content)
        self.assertEqual(content, '至于始作俑者——[PAT:捏住了「Ithi」的脸][心里嘀咕：她还笑得这么开心。]')

    def test_disabled_ai_cannot_execute_but_user_can_and_next_context_keeps_pats(self):
        import capabilities
        import context_builder
        from capabilities import process_pat_commands

        async def exercise():
            with patch.dict(capabilities.SETTINGS, {capabilities.CAPABILITY_SETTINGS_KEY: {'pat': True}}):
                await process_pat_commands(
                    '[PAT:揉了揉「Ithi」的头]', source_type='chatroom',
                    source_id='group', sender='connor',
                )
            self.broadcast.reset_mock()
            with patch.dict(capabilities.SETTINGS, {capabilities.CAPABILITY_SETTINGS_KEY: {'pat': False}}):
                cleaned = await process_pat_commands(
                    '晚安。[PAT:揉了揉「Ithi」的头]', source_type='chatroom',
                    source_id='group', sender='connor',
                )
                self.assertEqual(cleaned, '晚安。')
                self.broadcast.assert_not_called()
                # Also block callers that bypass parsing (e.g. a switch changed mid-generation).
                blocked = await pat.save_pat(pat.PatRequest(scope='chatroom', source_id='group', target='user'), actor='aion')
                self.assertIsNone(blocked)
                for scope, source_id, target, who in (
                    ('chatroom', 'group', 'connor', 'connor'),
                    ('chatroom', 'companion', 'connor', 'connor'),
                    ('private', 'private', 'aion', 'aion'),
                ):
                    message = await pat.save_pat(pat.PatRequest(scope=scope, source_id=source_id, target=target, suffix='的脸'))
                    async with pat.get_db() as db:
                        table, source_key, role_key = ('messages', 'conv_id', 'role') if scope == 'private' else ('chatroom_messages', 'room_id', 'sender')
                        await db.execute(f'INSERT INTO {table} (id, {source_key}, {role_key}, content, created_at, attachments) VALUES (?,?,?,?,?,?)',
                                         ('next-' + source_id, source_id, 'user', '刚刚感觉如何？', message['created_at'] + 0.01, '[]'))
                        await db.commit()
                    with patch.object(context_builder, 'get_db', pat.get_db):
                        merged = await context_builder.fetch_merged_timeline(who, 30, conv_id='private', room_id='group')
                        history = context_builder.render_merged_timeline(merged, who)
                    history_text = '\n'.join(item['content'] for item in history)
                    expected_target = 'Aion' if target == 'aion' else 'Connor'
                    self.assertIn(f'[PAT:拍了拍「{expected_target}」的脸]', history_text)
                    self.assertIn('刚刚感觉如何？', history_text)
                    self.assertIn('[PAT:揉了揉「Ithi」的头]', history_text)
        asyncio.run(exercise())

    def test_existing_capabilities_api_can_toggle_pat_without_disabling_human_endpoint(self):
        import capabilities
        from routes.capabilities import router

        self.client.app.include_router(router)
        with patch.dict(capabilities.SETTINGS, {capabilities.CAPABILITY_SETTINGS_KEY: {}}), patch.object(capabilities, 'save_settings'):
            disabled = self.client.put('/api/capabilities/pat', json={'enabled': False})
            self.assertEqual(disabled.status_code, 200)
            self.assertFalse(disabled.json()['capability']['enabled'])
            message = self.send(actor='aion').json()
            self.assertEqual(message['attachments'][0]['actor'], 'user')
            enabled = self.client.put('/api/capabilities/pat', json={'enabled': True})
            self.assertTrue(enabled.json()['capability']['enabled'])


class PatPromptAndStreamTests(unittest.TestCase):
    def test_pat_history_uses_actor_and_command_for_new_and_old_records(self):
        from context_builder import render_merged_timeline

        for actor, target, content, fields, expected in (
            ('aion', 'user', '「旧名字」伸手捏了捏「旧用户」刚洗完还水灵灵的脸蛋，凑近仔细端详', {},
             '[PAT:伸手捏了捏「旧用户」刚洗完还水灵灵的脸蛋，凑近仔细端详]'),
            ('connor', 'connor', '「旧名字」拍了拍自己', {}, '[PAT:拍了拍自己]'),
            ('aion', 'user', '界面展示文字', {'action': '揉了揉', 'suffix': '的头'}, '[PAT:揉了揉「小月」的头]'),
            ('connor', None, '界面展示文字', {'text': '捏了捏「小月」的爪子'}, '[PAT:捏了捏「小月」的爪子]'),
        ):
            with self.subTest(actor=actor, fields=fields), patch(
                'context_builder._timeline_display_names', return_value=('小月', '星星', '小熊')
            ), patch('chatroom.get_chatroom_names', return_value=('小月', '星星', '小熊')):
                history = render_merged_timeline([{
                    'id': 'pat', 'source': 'group', 'sender': 'system', 'content': content,
                    'attachments': [{'type': 'pat', 'actor': actor, 'target': target, **fields},
                                    {'type': 'system_model_context'}],
                }], 'aion')
                text = history[-1]['content']
                self.assertIn('历史消息 - ' + ('星星' if actor == 'aion' else '小熊') + '：' + expected, text)
                self.assertNotIn('系统事件', text)

    def test_capability_switch_removes_only_instruction_and_names_follow_config(self):
        import capabilities
        from capabilities import build_pat_ability_text

        self.assertEqual(capabilities.get_capability_def('pat').category, 'social')
        for enabled in (True, False):
            with patch.object(capabilities, 'is_capability_enabled', side_effect=lambda key: enabled and key == 'pat'):
                prompt = '\n'.join(asyncio.run(capabilities.build_capability_prompt_items('小月', who='connor', include_private_whisper=True)))
            self.assertEqual('[PAT:' in prompt, enabled)
        self.assertIn('「小月」', build_pat_ability_text('小月'))

    def test_protocol_never_leaks_to_streamed_text_tts_or_saved_reply(self):
        from context_builder import strip_tool_commands
        from safe_live_stream import KnownCommandStreamFilter
        from web_search import WebCommandStreamFilter
        from tts import split_text_for_tts

        text = '好呀。[PAT:拍了拍「Connor」的狗头]过来。'
        for filter_type in (KnownCommandStreamFilter, WebCommandStreamFilter):
            stream_filter = filter_type()
            visible = ''.join(stream_filter.feed(char) for char in text)
            visible += stream_filter.finish()[0] if filter_type is KnownCommandStreamFilter else stream_filter.flush()
            self.assertEqual(visible, '好呀。过来。')
        self.assertEqual(strip_tool_commands(text), '好呀。过来。')
        self.assertEqual(split_text_for_tts(text, min_chars=1, max_chars=500), ['好呀。过来。'])
        stream_filter = KnownCommandStreamFilter()
        visible = ''.join(stream_filter.feed(char) for char in '普通标签 [PATCH_01]') + stream_filter.finish()[0]
        self.assertEqual(visible, '普通标签 [PATCH_01]')


if __name__ == '__main__':
    unittest.main()
