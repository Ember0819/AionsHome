import json
import sys
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import aiosqlite


ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from context_builder import render_merged_timeline


def test_lounge_report_summary_remains_visible_in_later_model_timeline():
    summary = "刚才去朋友家聊了养花，对方最近在种薄荷。"
    rendered = render_merged_timeline(
        [
            {
                "source": "group",
                "sender": "aion",
                "content": summary,
                "created_at": 1786369912.0,
                "attachments": json.dumps(
                    [
                        {
                            "type": "lounge_visit_report",
                            "direction": "outbound",
                            "partner_name": "朋友",
                            "summary": summary,
                        }
                    ],
                    ensure_ascii=False,
                ),
            }
        ],
        "aion",
    )

    assert any(summary in item["content"] for item in rendered)


class GroupWindowContinuityTest(unittest.IsolatedAsyncioTestCase):
    async def test_new_group_uses_global_timeline_and_configured_limit(self):
        import chatroom
        import context_builder

        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "timeline.db"

            def connect():
                return aiosqlite.connect(db_path)

            async with connect() as db:
                await db.executescript("""
                    CREATE TABLE messages (
                        id TEXT, conv_id TEXT, role TEXT, content TEXT,
                        created_at REAL, attachments TEXT
                    );
                    CREATE TABLE chatroom_rooms (id TEXT, type TEXT);
                    CREATE TABLE chatroom_messages (
                        id TEXT, room_id TEXT, sender TEXT, content TEXT,
                        created_at REAL, attachments TEXT
                    );
                    INSERT INTO chatroom_rooms VALUES
                        ('old-group', 'group'), ('new-group', 'group'),
                        ('private-room', 'connor_1v1');
                """)
                # Insert out of time order; include private rows for each actor.
                for i in reversed(range(1, 41)):
                    content = f"timeline-row-{i:02d}"
                    if i % 5 == 0 and i != 40:
                        await db.execute(
                            "INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)",
                            (str(i), "private-conv", "user", content, i, "[]"),
                        )
                        room_id = "private-room"
                    else:
                        room_id = "new-group" if i == 40 else "old-group"
                    await db.execute(
                        "INSERT INTO chatroom_messages VALUES (?, ?, ?, ?, ?, ?)",
                        (str(i), room_id, "user", content, i, "[]"),
                    )
                await db.commit()

            with (
                patch.object(context_builder, "get_db", connect),
                patch.object(chatroom, "load_worldbook", return_value={}),
                patch.object(chatroom, "_read_connor_persona", return_value=""),
                patch.object(chatroom, "build_ability_block", new=AsyncMock(return_value="")),
                patch.object(chatroom, "with_current_device_context", side_effect=lambda history, **kw: history),
                patch.object(chatroom, "build_memory_blocks", new=AsyncMock(return_value={
                    "time_block": "test time", "memory_block": "", "digest_result": {},
                })),
            ):
                for build in (chatroom.build_aion_group_context, chatroom.build_connor_group_context):
                    for limit in (4, 32):
                        with self.subTest(actor=build.__name__, limit=limit):
                            history, _ = await build(
                                "new-group", [], context_limit=limit,
                                query_text="Continue the previous conversation",
                            )
                            actual = [
                                int(match)
                                for message in history
                                for match in re.findall(r"timeline-row-(\d+)", message["content"])
                            ]
                            self.assertEqual(list(range(41 - limit, 41)), actual)
