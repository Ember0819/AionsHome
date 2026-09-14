import asyncio
import json
import unittest
from unittest.mock import AsyncMock

from ws import ConnectionManager
from tts import TTSStreamer


class TTSRoutingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.manager = ConnectionManager()
        self.phone = AsyncMock()
        self.desktop = AsyncMock()
        for client, client_id, active_at in (
            (self.phone, "phone", 20), (self.desktop, "desktop", 10)
        ):
            await self.manager.connect(client)
            self.manager.register_client_id(client, client_id)
            self.manager.set_tts_state(client, True, "voice", active_at=active_at)

    async def emit(self, kind, msg_id="message", seq=None):
        data = {"msg_id": msg_id}
        if seq is not None:
            data["seq"] = seq
        await self.manager.send_tts_event({"type": kind, "data": data})

    async def test_focus_change_keeps_chunks_and_done_on_same_device(self):
        # Synthesis may finish seq 1 before seq 0.
        await self.emit("tts_chunk", seq=1)
        self.manager.set_tts_state(self.desktop, True, "voice", active_at=30)
        await self.emit("tts_chunk", seq=0)
        await self.emit("tts_done")
        events = [json.loads(call.args[0]) for call in self.phone.send_text.call_args_list]
        self.assertEqual([e["type"] for e in events], ["tts_chunk", "tts_chunk", "tts_done"])
        self.assertTrue(all(e["data"]["target_client_id"] == "phone" for e in events))
        self.desktop.send_text.assert_not_awaited()
        await self.emit("tts_chunk", msg_id="next", seq=0)
        self.desktop.send_text.assert_awaited_once()

    async def test_disconnected_owner_falls_back_to_available_device(self):
        await self.emit("tts_chunk", seq=0)
        self.manager.disconnect(self.phone)
        await self.emit("tts_chunk", seq=1)
        await self.emit("tts_done")
        self.assertEqual(self.desktop.send_text.await_count, 2)

    async def test_failed_owner_falls_back_to_available_device(self):
        await self.emit("tts_chunk", seq=0)
        self.phone.send_text.side_effect = RuntimeError("connection lost")
        await self.emit("tts_done")
        self.desktop.send_text.assert_awaited_once()

    async def test_sse_copy_uses_the_same_target_as_websocket(self):
        queue = asyncio.Queue()
        streamer = TTSStreamer("message", "voice", self.manager, sse_queue=queue)
        await streamer._notify({"type": "tts_chunk", "data": {"msg_id": "message", "seq": 0}})
        ws_event = json.loads(self.phone.send_text.call_args.args[0])
        self.assertEqual(await queue.get(), ws_event)
        self.assertEqual(ws_event["data"]["target_client_id"], "phone")
