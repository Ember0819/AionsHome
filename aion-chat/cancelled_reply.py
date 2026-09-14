"""Persist visible partial replies without invoking tools, links, or speech."""
import json
import time

from database import get_db
from safe_live_stream import KnownCommandStreamFilter


async def save_cancelled_replies(scope, clean_text):
    messages = []
    async with get_db() as db:
        for partial in scope.partials.values():
            # Do not flush an unfinished command at the interruption boundary.
            text = clean_text(KnownCommandStreamFilter().feed(partial['content'])).strip()
            if not text:
                continue
            now = time.time()
            if scope.surface == 'private':
                cursor = await db.execute(
                    'INSERT OR IGNORE INTO messages (id, conv_id, role, content, created_at, attachments) VALUES (?,?,?,?,?,?)',
                    (partial['id'], scope.target, 'assistant', text, now, '[]'))
                message = dict(id=partial['id'], conv_id=scope.target, role='assistant', content=text, created_at=now, attachments=[])
                table, key, target_table = 'messages', 'conv_id', 'conversations'
            else:
                cursor = await db.execute(
                    'INSERT OR IGNORE INTO chatroom_messages (id, room_id, sender, content, created_at, attachments) VALUES (?,?,?,?,?,?)',
                    (partial['id'], scope.target, partial['sender'], text, now, '[]'))
                message = dict(id=partial['id'], room_id=scope.target, sender=partial['sender'], content=text, created_at=now, attachments=[])
                table, key, target_table = 'chatroom_messages', 'room_id', 'chatroom_rooms'
            if cursor.rowcount:
                await db.execute(f'UPDATE {target_table} SET updated_at=? WHERE id=?', (now, scope.target))
            else:
                # A reply may have been committed just before stop arrived.
                cur = await db.execute(f'SELECT content, created_at, attachments FROM {table} WHERE id=? AND {key}=?', (partial['id'], scope.target))
                row = await cur.fetchone()
                if row:
                    message.update(content=row[0], created_at=row[1], attachments=json.loads(row[2] or '[]'))
            message['interrupted'] = True
            messages.append(message)
        await db.commit()
    # This is state reconciliation only. Normal message-created broadcasts can
    # trigger notification, WeChat mirroring and other post-reply actions.
    from ws import manager
    await manager.broadcast({'type': 'generation_stopped', 'data': {
        'generation_id': scope.id, 'surface': scope.surface, 'target': scope.target,
        'message_ids': list(scope.message_ids), 'messages': messages,
    }})
    return messages
