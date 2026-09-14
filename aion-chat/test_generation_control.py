import asyncio
import unittest
import tempfile
from pathlib import Path
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI

from generation_control import Generation, GenerationQueue, cancellable, cancel_generation, current_generation, generation_status, spawn_generation_task


class GenerationControlTests(unittest.IsolatedAsyncioTestCase):
    async def test_stop_interrupts_waiting_provider_and_followup(self):
        scope = Generation('chatroom', 'room', 'waiting')
        started = asyncio.Event()
        closed = asyncio.Event()
        child_closed = asyncio.Event()
        actions = []

        async def child():
            try:
                await asyncio.Event().wait()
                actions.append('late action')
            finally:
                child_closed.set()

        async def provider():
            try:
                spawn_generation_task(child())
                await asyncio.sleep(0)
                started.set()
                await asyncio.Event().wait()
                actions.append('second speaker')
            finally:
                closed.set()

        task = scope.start(provider())
        await started.wait()
        result = await cancel_generation('chatroom', 'room', 'waiting')
        self.assertTrue(result['ok'])
        self.assertTrue(closed.is_set())
        self.assertTrue(child_closed.is_set())
        self.assertTrue(task.cancelled())
        self.assertEqual(actions, [])

    async def test_early_stop_and_old_stop_do_not_cancel_new_message(self):
        await cancel_generation('chatroom', 'room', 'early')
        early = Generation('chatroom', 'room', 'early')
        ran = []

        async def work():
            ran.append(True)
            await asyncio.Event().wait()

        old = early.start(work())
        await asyncio.gather(old, return_exceptions=True)
        await asyncio.sleep(0)
        self.assertEqual(ran, [])
        self.assertFalse(generation_status('chatroom', 'room', 'early')['active'])
        fresh = Generation('chatroom', 'room', 'fresh')
        task = fresh.start(work())
        await asyncio.sleep(0)
        await cancel_generation('chatroom', 'room', 'early')
        self.assertFalse(task.done())
        await cancel_generation('chatroom', 'room', 'fresh')

    async def test_followup_stays_owned_after_parent_finishes(self):
        scope = Generation('private', 'conv', 'followup')
        children = []

        async def parent():
            children.append(spawn_generation_task(asyncio.Event().wait()))

        await scope.start(parent())
        await cancel_generation('private', 'conv', 'followup')
        self.assertTrue(children[0].cancelled())

    async def test_cancel_calls_resource_cleanup_and_context_is_local(self):
        scope = Generation('private', 'conv', 'resource')
        cleaned = []

        async def work():
            self.assertIs(current_generation(), scope)
            scope.on_cancel.append(lambda: cleaned.append(True))
            await asyncio.Event().wait()

        scope.start(work())
        await asyncio.sleep(0)
        self.assertIsNone(current_generation())
        await cancel_generation('private', 'conv', 'resource')
        self.assertEqual(cleaned, [True])

    async def test_queue_drops_late_commands_and_preserves_partial_snapshot(self):
        saved = []

        async def save(scope):
            saved.extend(scope.partials.values())
            return []

        scope = Generation('private', 'conv', 'partial', save)
        queues = []

        async def work():
            queue = GenerationQueue()
            queues.append(queue)
            await queue.put({'type': 'start', 'id': 'reply'})
            await queue.put({'type': 'chunk', 'content': 'before reset'})
            await queue.put({'type': 'stream_reset'})
            await queue.put({'type': 'replace', 'content': 'visible text'})
            try:
                await asyncio.Event().wait()
            finally:
                await queue.put({'type': 'toy_command', 'commands': ['late']})

        scope.start(work())
        await asyncio.sleep(0)
        await cancel_generation('private', 'conv', 'partial')
        self.assertEqual(saved[0]['content'], 'visible text')
        self.assertEqual([queues[0].get_nowait()['type'] for _ in range(queues[0].qsize())], ['stopped', 'done'])

    async def test_chatroom_http_stop_closes_real_reply_pipeline_without_tools(self):
        from routes import chatroom
        app = FastAPI()
        app.include_router(chatroom.router)
        ready, closed = asyncio.Event(), asyncio.Event()
        saved = []

        async def source(*args, **kwargs):
            try:
                yield '这是一段已经收到的回复。' * 40
                ready.set()
                await asyncio.Event().wait()
            finally:
                closed.set()

        async def save(scope, cleaner):
            saved.extend(scope.partials.values())
            return []

        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://test') as client:
            with patch.object(chatroom, '_save_msg', AsyncMock(return_value={'id': 'user'})), \
                 patch.object(chatroom, '_load_room_and_messages', AsyncMock(return_value=({'type': 'connor_1v1'}, [{'content': 'hello'}]))), \
                 patch.object(chatroom, 'record_chatroom_active', AsyncMock()), \
                 patch.object(chatroom, 'build_connor_1v1_context', AsyncMock(return_value=([{'role': 'user', 'content': 'hello'}], {}))), \
                 patch.object(chatroom, '_stream_connor_model', source), \
                 patch.object(chatroom, 'resolve_model_transport_mode', return_value='legacy'), \
                 patch.object(chatroom, 'save_cancelled_replies', side_effect=save), \
                 patch.object(chatroom, '_process_chatroom_commands', AsyncMock()) as commands:
                pending = asyncio.create_task(client.post('/api/chatroom/rooms/test-room/send', json={'content': 'hello'}, headers={'X-Generation-Id': 'http-stop'}))
                await asyncio.wait_for(ready.wait(), 3)
                response = await client.post('/api/chatroom/rooms/test-room/abort?generation_id=http-stop')
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.json()['stopped'])
                self.assertTrue(closed.is_set())
                self.assertTrue(saved[0]['content'])
                commands.assert_not_awaited()
                original = await asyncio.wait_for(pending, 3)
                self.assertEqual(original.status_code, 200)
                self.assertIn('stopped', original.text)
                self.assertFalse(generation_status('chatroom', 'test-room', 'http-stop')['active'])

    async def test_custom_relay_connection_closes_even_between_chunks(self):
        from ai_providers import call_custom_openai
        closed, ready = asyncio.Event(), asyncio.Event()

        class Body(httpx.AsyncByteStream):
            async def __aiter__(self):
                yield b'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n'
                await asyncio.Event().wait()

            async def aclose(self):
                closed.set()

        relay = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, stream=Body())))

        async def work():
            async for text in call_custom_openai([], {'model': 'unit', 'base_url': 'http://relay.test/v1'}):
                self.assertEqual(text, 'hello')
                ready.set()
                # Cancellation while the provider generator is suspended at yield.
                await asyncio.Event().wait()

        with patch('ai_providers.httpx.AsyncClient', return_value=relay):
            scope = Generation('private', 'conv', 'relay')
            scope.start(work())
            await asyncio.wait_for(ready.wait(), 2)
            await cancel_generation('private', 'conv', 'relay')
        self.assertTrue(closed.is_set())

    async def test_http_stop_during_prompt_preparation_returns_normal_stop(self):
        app = FastAPI()
        ready = asyncio.Event()

        @app.post('/rooms/{room_id}/send')
        @cancellable('chatroom', AsyncMock(return_value=[]))
        async def send(room_id: str):
            ready.set()
            await asyncio.Event().wait()

        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://test') as client:
            pending = asyncio.create_task(client.post('/rooms/preparing/send', headers={'X-Generation-Id': 'prepare'}))
            await asyncio.wait_for(ready.wait(), 2)
            await cancel_generation('chatroom', 'preparing', 'prepare')
            response = await asyncio.wait_for(pending, 2)
            self.assertEqual(response.status_code, 200)
            self.assertIn('stopped', response.text)

    async def test_tts_workers_and_notifications_stop_together(self):
        import tts
        started, closed = asyncio.Event(), asyncio.Event()
        ws = AsyncMock()

        async def audio(*args, **kwargs):
            try:
                started.set()
                await asyncio.Event().wait()
            finally:
                closed.set()

        with tempfile.TemporaryDirectory() as directory:
            async def work():
                streamer = tts.TTSStreamer('stop-tts', 'voice', ws, min_chars=1, max_chars=2, cache_dir=Path(directory))
                await streamer.feed_async('这句还没合成完。')
                await streamer.flush()

            with patch.object(tts, '_request_tts_audio', side_effect=audio):
                scope = Generation('private', 'conv', 'tts')
                scope.start(work())
                await asyncio.wait_for(started.wait(), 2)
                await asyncio.wait_for(cancel_generation('private', 'conv', 'tts'), 2)
            self.assertTrue(closed.is_set())
            ws.send_tts_event.assert_not_awaited()
            self.assertEqual(list(Path(directory).iterdir()), [])

    async def test_partial_save_does_not_execute_tools_or_overwrite_committed_reply(self):
        import aiosqlite
        import cancelled_reply
        with tempfile.TemporaryDirectory() as directory:
            db_path = Path(directory) / 'test.db'

            @asynccontextmanager
            async def db():
                async with aiosqlite.connect(db_path) as connection:
                    yield connection

            async with db() as connection:
                await connection.executescript('''
                    CREATE TABLE conversations (id TEXT PRIMARY KEY, updated_at REAL);
                    INSERT INTO conversations VALUES ('conv', 0);
                    CREATE TABLE messages (id TEXT PRIMARY KEY, conv_id TEXT, role TEXT, content TEXT, created_at REAL, attachments TEXT);
                    INSERT INTO messages VALUES ('saved', 'conv', 'assistant', 'already saved', 1, '[]');
                ''')
            scope = Generation('private', 'conv', 'save-test')
            scope.partials = {
                'partial': {'id': 'partial', 'sender': 'assistant', 'content': '收到啦。[TOY:unfinished'},
                'saved': {'id': 'saved', 'sender': 'assistant', 'content': 'stale partial'},
                'empty': {'id': 'empty', 'sender': 'assistant', 'content': ''},
            }
            with patch.object(cancelled_reply, 'get_db', db), patch('ws.manager.broadcast', AsyncMock()) as broadcast:
                messages = await cancelled_reply.save_cancelled_replies(scope, lambda text: text)
            self.assertEqual([m['content'] for m in messages], ['收到啦。', 'already saved'])
            self.assertEqual(broadcast.await_args.args[0]['type'], 'generation_stopped')
            await cancel_generation('private', 'conv', 'save-test')


if __name__ == '__main__':
    unittest.main()
