"""One synthesis entry point for free speech, manual reading and streaming."""
import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import tts
from routes import settings


async def edge_chunks():
    yield {"type": "WordBoundary", "text": "晚安"}
    yield {"type": "audio", "data": b"mp3-first"}
    yield {"type": "audio", "data": b"mp3-last"}


class TTSProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_free_voice_needs_no_key_and_uses_existing_stream_cache(self):
        with tempfile.TemporaryDirectory() as td, \
             patch("tts.get_key", side_effect=AssertionError("Free TTS must not read paid credentials")), \
             patch("edge_tts.Communicate") as communicate:
            communicate.return_value.stream.side_effect = edge_chunks
            events = asyncio.Queue()
            streamer = tts.TTSStreamer("edge_test", "edge:zh-CN-XiaoxiaoNeural",
                                       sse_queue=events, cache_dir=Path(td), cache_max_bytes=None)
            streamer.feed("今晚的月色很温柔。")
            await streamer.flush()
            self.assertEqual((Path(td) / "edge_test_s0.mp3").read_bytes(), b"mp3-firstmp3-last")
            event = await events.get()
            self.assertEqual(event["type"], "tts_chunk")
            self.assertEqual(event["data"]["url"], "/api/tts/audio/edge_test_s0")
            self.assertEqual(communicate.call_args.kwargs["voice"], "zh-CN-XiaoxiaoNeural")

    async def test_manual_reading_uses_same_dispatch_and_cache(self):
        with tempfile.TemporaryDirectory() as td, \
             patch.object(settings, "TTS_CACHE_DIR", Path(td)), \
             patch("tts.get_key", return_value=""), \
             patch.object(settings, "get_key", return_value=""), \
             patch("edge_tts.Communicate") as communicate:
            communicate.return_value.stream.side_effect = edge_chunks
            response = await settings.tts_synthesize(settings.TTSRequest(
                text="晚安。", voice="edge:zh-CN-XiaoxiaoNeural", msg_id="manual_edge"))
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.body, b"mp3-firstmp3-last")
            self.assertEqual((Path(td) / "manual_edge.mp3").read_bytes(), response.body)

    async def test_free_voices_survive_missing_or_failing_paid_service(self):
        favorites = {"edge_tts_favorites": ["edge:zh-CN-XiaoxiaoNeural"]}
        with patch.object(settings, "SETTINGS", favorites), \
             patch.object(settings, "get_key", return_value=""):
            result = await settings.tts_voice_list()
        self.assertEqual([v["uri"] for v in result["voices"]], favorites["edge_tts_favorites"])
        with patch.object(settings, "SETTINGS", favorites), \
             patch.object(settings, "get_key", return_value="test"), \
             patch.object(settings.httpx, "AsyncClient") as client:
            client.return_value.__aenter__.return_value.get = AsyncMock(side_effect=RuntimeError("offline"))
            failed = await settings.tts_voice_list()
        self.assertEqual(result["voices"], failed["voices"])

    async def test_catalog_keeps_all_voices_but_candidates_only_include_favorites(self):
        with patch.object(settings, "SETTINGS", {}), \
             patch.object(settings, "get_key", return_value=""), \
             patch.object(settings, "save_settings") as save:
            self.assertEqual((await settings.tts_voice_list())["voices"], [])
            catalog = await settings.edge_voice_catalog()
            self.assertEqual(len(catalog["voices"]), len(tts.EDGE_VOICES))
            voice = tts.EDGE_VOICES[0]["uri"]
            await settings.set_edge_voice_favorite(settings.EdgeVoiceFavorite(voice=voice, favorite=True))
            self.assertEqual([v["uri"] for v in (await settings.tts_voice_list())["voices"]], [voice])
            self.assertEqual(save.call_args.args[0]["edge_tts_favorites"], [voice])
            await settings.set_edge_voice_favorite(settings.EdgeVoiceFavorite(voice=voice, favorite=False))
            self.assertEqual((await settings.tts_voice_list())["voices"], [])
            with self.assertRaises(settings.HTTPException):
                await settings.set_edge_voice_favorite(settings.EdgeVoiceFavorite(voice="speech:paid", favorite=True))

    async def test_paid_voice_and_request_settings_are_preserved(self):
        with patch("tts.get_key", return_value="test"), patch.object(tts.httpx, "AsyncClient") as client:
            post = client.return_value.__aenter__.return_value.post
            post.return_value.status_code = 200
            post.return_value.content = b"paid-mp3"
            result = await tts._request_tts_audio("你好。", "speech:existing-custom-voice")
        self.assertEqual(result, b"paid-mp3")
        body = post.call_args.kwargs["json"]
        self.assertEqual(body["voice"], "speech:existing-custom-voice")
        self.assertEqual(body["gain"], 0)


if __name__ == "__main__":
    unittest.main()
