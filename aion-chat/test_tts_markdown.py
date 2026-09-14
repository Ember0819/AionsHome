import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import tts


REPORT = """## 情感报告
* **异常状态**：需要拥抱。

---

> 先抱一下。
1. `PATCH_01`：伸出爪子。
- [x] ~~修复~~完成。
"""


class TTSMarkdownTests(unittest.TestCase):
    def test_report_keeps_words_without_markdown(self):
        self.assertEqual(
            tts.split_text_for_tts(REPORT),
            ["情感报告\n异常状态：需要拥抱。\n\n先抱一下。\nPATCH_01：伸出爪子。\n修复完成。"],
        )

    def test_decoration_only_does_not_create_audio_segments(self):
        self.assertEqual(tts.split_text_for_tts("---\n* * *\n___\n===\n```\n```"), [])

    def test_content_symbols_and_link_labels_survive(self):
        text = "温度 -5°C，3 - 2 = 1，Aion-Oloth，PATCH_01。\n[资料](https://example.com)\n```python\nprint(1)\n```"
        self.assertEqual(
            tts.split_text_for_tts(text),
            ["温度 -5°C，3 - 2 = 1，Aion-Oloth，PATCH_01。\n资料\n\nprint(1)"],
        )


class TTSMarkdownStreamingTests(unittest.IsolatedAsyncioTestCase):
    async def test_incomplete_numbered_list_prefix_waits_for_next_chunk(self):
        with tempfile.TemporaryDirectory() as td:
            streamer = tts.TTSStreamer(
                "list_prefix", "voice", min_chars=12, max_chars=24,
                cache_dir=Path(td), cache_max_bytes=None,
            )
            spoken = []

            async def record_segment(text):
                spoken.append(text)

            with patch.object(streamer, "_enqueue_segment", new=record_segment):
                await streamer.feed_async("这段正文还没有结束请继续听\n1.")
                self.assertEqual(spoken, [])
                await streamer.feed_async(" **先抱一下。**")
                await streamer.flush()
            self.assertEqual("".join("".join(spoken).split()), "这段正文还没有结束请继续听先抱一下。")

    async def test_markdown_is_removed_before_audio_requests_across_chunk_boundaries(self):
        text = REPORT + "\n" + "-" * 40 + "\n**再抱一下。**"
        for chunk_size in (1, 7, len(text)):
            with self.subTest(chunk_size=chunk_size), tempfile.TemporaryDirectory() as td:
                spoken = []

                async def record_audio(content, _voice, *, seq=None):
                    spoken.append((seq, content))
                    return None

                streamer = tts.TTSStreamer(
                    "markdown", "voice", min_chars=12, max_chars=24,
                    cache_dir=Path(td), cache_max_bytes=None,
                )
                with patch.object(tts, "_request_tts_audio", new=record_audio):
                    for start in range(0, len(text), chunk_size):
                        await streamer.feed_async(text[start:start + chunk_size])
                    await streamer.flush()
                actual = "".join(content for _, content in sorted(spoken))
                expected = "情感报告异常状态：需要拥抱。先抱一下。PATCH_01：伸出爪子。修复完成。再抱一下。"
                self.assertEqual("".join(actual.split()), expected)


if __name__ == "__main__":
    unittest.main()
