import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import aiosqlite

from test_calendar_memory_compression import local_ts


class AutoCompressionTests(unittest.IsolatedAsyncioTestCase):
    async def test_waits_until_five_or_actual_retry_deadline(self):
        now = local_ts('2026-09-07 05:00')
        with patch.object(self.scheduler, 'compress_target', AsyncMock(return_value={'ok': True})):
            await self.scheduler.run_due_compression(now)
        self.assertEqual(await self.scheduler.next_check_delay(now), 24*60*60)
        self.assertEqual(await self.scheduler.next_check_delay(now+3600), 23*60*60)
        async with self.scheduler.get_db() as db:
            await db.execute("UPDATE memory_compression_schedule SET status='failed',attempts=1,retry_after=? WHERE target='main'", (now+1800,))
            await db.commit()
        self.assertEqual(await self.scheduler.next_check_delay(now), 1800)
        async with self.scheduler.get_db() as db:
            await db.execute("UPDATE memory_compression_schedule SET attempts=2 WHERE target='main'")
            await db.commit()
        self.assertEqual(await self.scheduler.next_check_delay(now), 86400)

    async def asyncSetUp(self):
        import memory_compression_scheduler as scheduler
        self.scheduler = scheduler
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmp.name) / "chat.db"
        self.db_patch = patch.object(scheduler, "get_db", self.connect)
        self.db_patch.start()
        await scheduler.ensure_schedule_schema()

    async def asyncTearDown(self):
        self.db_patch.stop()
        self.tmp.cleanup()

    def connect(self):
        return aiosqlite.connect(self.db_path)

    async def test_catch_up_once_per_five_am_day_survives_restart(self):
        run = AsyncMock(return_value={"ok": True})
        with patch.object(self.scheduler, "compress_target", run):
            await self.scheduler.run_due_compression(local_ts("2026-09-07 18:00"))
            self.assertEqual(run.await_count, 2)
            await self.scheduler.run_due_compression(local_ts("2026-09-08 04:59"))
            self.assertEqual(run.await_count, 2)
            # All completion state lives in SQLite, not a loop-local timestamp.
            await self.scheduler.ensure_schedule_schema()
            await self.scheduler.run_due_compression(local_ts("2026-09-08 05:00"))
            self.assertEqual(run.await_count, 4)

    async def test_failed_store_retries_after_cooldown_without_repeating_other_store(self):
        async def fail_main(target):
            return {"ok": target != "main", "message": "model unavailable"}

        start = local_ts("2026-09-07 05:00")
        run = AsyncMock(side_effect=fail_main)
        with patch.object(self.scheduler, "compress_target", run):
            await self.scheduler.run_due_compression(start)
            await self.scheduler.run_due_compression(start + 60)
            self.assertEqual(run.await_count, 2)
            for minutes in (30, 60, 90, 120):
                await self.scheduler.run_due_compression(start + minutes * 60)
            self.assertEqual(run.await_count, 3)  # main: initial + one retry; chatroom: 1
            await self.scheduler.ensure_schedule_schema()
            await self.scheduler.run_due_compression(local_ts("2026-09-08 04:59"))
            self.assertEqual(run.await_count, 3)
            await self.scheduler.run_due_compression(local_ts("2026-09-08 05:00"))
            self.assertEqual(run.await_count, 5)  # a fresh daily attempt for each store

    async def test_daily_then_weekly_only_and_latest_chatroom_model(self):
        created = []
        tasks = {}

        async def create(target, level, model_key):
            created.append((target, level, model_key))
            job_id = str(len(created))
            tasks[job_id] = asyncio.create_task(asyncio.sleep(0))
            return {"ok": True, "job": {"id": job_id}}

        with patch.object(self.scheduler, "compression_preview", AsyncMock(return_value={"can_run": True})), patch.object(
            self.scheduler, "load_chatroom_config", side_effect=[{"connor_model": "first"}, {"connor_model": "latest"}]
        ), patch.object(self.scheduler, "create_calendar_compression_job", create), patch.object(
            self.scheduler, "_ACTIVE_JOB_TASKS", tasks
        ), patch.object(self.scheduler, "get_calendar_compression_job", AsyncMock(return_value={"status": "completed"})):
            result = await self.scheduler.compress_target("main")
        self.assertTrue(result["ok"])
        self.assertEqual(created, [("main", "daily", "first"), ("main", "weekly", "latest")])

    async def test_no_candidates_never_start_job_and_daily_failure_stops_weekly(self):
        create = AsyncMock(return_value={"ok": False, "message": "invalid model"})
        with patch.object(self.scheduler, "compression_preview", AsyncMock(return_value={"can_run": False})), patch.object(
            self.scheduler, "create_calendar_compression_job", create
        ):
            self.assertTrue((await self.scheduler.compress_target("main"))["ok"])
            create.assert_not_awaited()
        with patch.object(self.scheduler, "compression_preview", AsyncMock(return_value={"can_run": True})), patch.object(
            self.scheduler, "load_chatroom_config", return_value={"connor_model": "model"}
        ), patch.object(self.scheduler, "create_calendar_compression_job", create):
            self.assertFalse((await self.scheduler.compress_target("main"))["ok"])
            self.assertEqual(create.await_count, 1)

    async def test_startup_recovers_orphans_but_preserves_live_manual_jobs(self):
        import memory_compression

        live = asyncio.create_task(asyncio.sleep(60))
        try:
            with patch.object(memory_compression, "get_db", self.connect), patch.object(
                memory_compression, "_ACTIVE_JOB_TASKS", {"live": live}
            ):
                await memory_compression.ensure_calendar_compression_schema()
                async with self.connect() as db:
                    for job_id in ("orphan", "live"):
                        await db.execute(
                            "INSERT INTO memory_compression_jobs "
                            "(id,target,level,model_key,status,created_at,updated_at) "
                            "VALUES (?,'main','daily','model','running',0,0)", (job_id,)
                        )
                    await db.commit()
                await self.scheduler.recover_interrupted_jobs()
                async with self.connect() as db:
                    rows = await (await db.execute("SELECT id,status FROM memory_compression_jobs")).fetchall()
                self.assertEqual(dict(rows), {"orphan": "failed", "live": "running"})
        finally:
            live.cancel()
            await asyncio.gather(live, return_exceptions=True)

    async def test_manual_busy_defers_without_consuming_failure_budget(self):
        busy = AsyncMock(return_value={"ok": False, "reason": "already_running"})
        with patch.object(self.scheduler, "compress_target", busy):
            await self.scheduler.run_due_compression(local_ts("2026-09-07 05:00"))
        async with self.connect() as db:
            rows = await (await db.execute("SELECT attempts FROM memory_compression_schedule")).fetchall()
        self.assertEqual([row[0] for row in rows], [0, 0])


if __name__ == "__main__":
    unittest.main()
