import unittest
from unittest.mock import patch

import location


class LocationChatStatusCacheTest(unittest.IsolatedAsyncioTestCase):
    async def test_location_refresh_writes_only_location_and_weather(self):
        status = {
            "state": "outside",
            "address": "测试地点",
            "distance_from_home": 1200,
            "weather": {
                "weather": "晴",
                "temperature": "23",
                "humidity": "28",
            },
        }

        with patch.object(location, "save_chat_status") as save:
            await location._update_chat_status_location(status)

        saved = save.call_args.args[0]
        self.assertEqual(
            saved,
            "[位置] 外出中，当前在：测试地点，距离家1.2km\n[天气] 晴 23°C 湿度28%",
        )
        self.assertNotIn("准备", saved)


if __name__ == "__main__":
    unittest.main()
