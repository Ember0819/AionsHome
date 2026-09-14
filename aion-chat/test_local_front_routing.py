import unittest
from unittest.mock import AsyncMock, patch

import memory
from context_builder import _build_recall_query


PARTICIPANTS = {
    "user": "Ithil",
    "aion": "Aion",
    "connor": "Connor",
}


class LocalFrontRoutingTest(unittest.IsolatedAsyncioTestCase):
    async def test_simple_message_uses_raw_text_without_calling_model(self):
        model_call = AsyncMock(side_effect=AssertionError("front routing must stay local"))
        text = "老公，老公，我要开始工作了！😸"

        with patch.object(memory, "_call_sentinel_text", model_call):
            result = await memory.instant_digest(
                [{"role": "user", "sender": "user", "content": text}],
                group_participants=PARTICIPANTS,
            )

        model_call.assert_not_awaited()
        self.assertEqual(result["topic"], text)
        self.assertEqual(
            _build_recall_query(
                result["topic"],
                result["keywords"],
                query_text=text,
            ),
            text,
        )
        self.assertFalse(result["is_search_needed"])
        self.assertFalse(result["require_detail"])
        self.assertEqual(result["first_responder"], "random")
        self.assertEqual(result["status"], "")

    async def test_explicit_first_speaker_uses_configured_names(self):
        cases = {
            "这个问题Connor先说": "connor",
            "先让Aion回答吧": "aion",
            "Connor，你怎么看？": "connor",
            "Aion和Connor，你们谁先说都行": "random",
            "不是Connor先说，让Aion先说": "aion",
        }

        for text, expected in cases.items():
            with self.subTest(text=text):
                result = await memory.instant_digest(
                    [{"role": "user", "sender": "user", "content": text}],
                    group_participants=PARTICIPANTS,
                )
                self.assertEqual(result["first_responder"], expected)

    async def test_memory_reference_flags_are_local(self):
        text = "上次看的那个电影叫什么名字？"
        result = await memory.instant_digest(
            [{"role": "user", "sender": "user", "content": text}],
            group_participants=PARTICIPANTS,
        )

        self.assertTrue(result["is_search_needed"])
        self.assertTrue(result["require_detail"])
        self.assertEqual(result["topic"], text)

    async def test_renamed_participants_are_routed_from_runtime_config(self):
        renamed = {"user": "小鬣狗", "aion": "阿昼", "connor": "阿夜"}
        result = await memory.instant_digest(
            [{"role": "user", "sender": "user", "content": "这次阿夜先回答"}],
            group_participants=renamed,
        )

        self.assertEqual(result["first_responder"], "connor")


if __name__ == "__main__":
    unittest.main()
