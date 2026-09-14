"""Daily 05:00 calendar compression, with persisted catch-up and bounded retries."""

import asyncio
import logging
import time
from datetime import datetime, timedelta

import aiosqlite

from chatroom import load_chatroom_config
from database import get_db
from memory_compression import (
    DAY_START_HOUR,
    _ACTIVE_JOB_TASKS,
    compression_preview,
    create_calendar_compression_job,
    ensure_calendar_compression_schema,
    get_calendar_compression_job,
    memory_day_for_ts,
)

logger = logging.getLogger(__name__)
RETRY_SECONDS = 30 * 60
MAX_ATTEMPTS = 2  # initial attempt + one retry per memory day


async def ensure_schedule_schema():
    async with get_db() as db:
        await db.execute(
            "CREATE TABLE IF NOT EXISTS memory_compression_schedule ("
            "target TEXT PRIMARY KEY, day TEXT NOT NULL, status TEXT NOT NULL, "
            "attempts INTEGER NOT NULL, retry_after REAL NOT NULL, "
            "error TEXT NOT NULL DEFAULT '')"
        )
        await db.commit()


async def recover_interrupted_jobs():
    async with get_db() as db:
        rows = await (await db.execute(
            "SELECT id FROM memory_compression_jobs WHERE status IN ('queued','running')"
        )).fetchall()
    for row in rows:
        # The existing job service preserves live tasks and closes orphaned ones.
        await get_calendar_compression_job(row[0])


async def compress_target(target: str) -> dict:
    for level in ("daily", "weekly"):
        preview = await compression_preview(target, level)
        if not preview["can_run"]:
            continue
        # Read again for each job; changes in chatroom settings take effect here.
        model_key = str(load_chatroom_config().get("connor_model") or "").strip()
        started = await create_calendar_compression_job(target, level, model_key)
        if not started.get("ok"):
            if started.get("reason") == "no_candidates":
                continue
            return started
        job_id = started["job"]["id"]
        task = _ACTIVE_JOB_TASKS.get(job_id)
        if task is not None:
            await task
        job = await get_calendar_compression_job(job_id)
        if not job or job["status"] != "completed":
            return {"ok": False, "message": (job or {}).get("error") or "压缩任务未完成"}
    return {"ok": True}


async def run_due_compression(now_ts: float | None = None):
    now = time.time() if now_ts is None else now_ts
    # Before 05:00 this is yesterday's slot, so a restart can still catch it up.
    day = memory_day_for_ts(now)
    for target in ("main", "chatroom"):
        async with get_db() as db:
            db.row_factory = aiosqlite.Row
            row = await (await db.execute(
                "SELECT * FROM memory_compression_schedule WHERE target=?", (target,)
            )).fetchone()
            same_day = row is not None and row["day"] == day
            if same_day and (
                row["status"] == "completed"
                or row["attempts"] >= MAX_ATTEMPTS
                or row["retry_after"] > now
            ):
                continue
            attempts = (row["attempts"] if same_day else 0) + 1
            await db.execute(
                "INSERT INTO memory_compression_schedule (target,day,status,attempts,retry_after) "
                "VALUES (?,?,'running',?,?) ON CONFLICT(target) DO UPDATE SET "
                "day=excluded.day,status=excluded.status,attempts=excluded.attempts,"
                "retry_after=excluded.retry_after,error=''",
                (target, day, attempts, now + RETRY_SECONDS),
            )
            await db.commit()
        try:
            result = await compress_target(target)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("Automatic memory compression failed for %s", target)
            result = {"ok": False, "message": str(exc)}
        finished = time.time() if now_ts is None else now_ts
        ok = bool(result.get("ok"))
        busy = result.get("reason") == "already_running"
        error = "" if ok else str(result.get("message") or "压缩失败")
        async with get_db() as db:
            await db.execute(
                "UPDATE memory_compression_schedule SET status=?,attempts=?,retry_after=?,error=? "
                "WHERE target=?",
                ("completed" if ok else "failed", attempts - int(busy),
                 finished + RETRY_SECONDS, error, target),
            )
            await db.commit()
        if not ok:
            logger.warning("Automatic memory compression %s (%s/%s): %s", target, attempts, MAX_ATTEMPTS, error)


async def next_check_delay(now_ts: float | None = None):
    now = time.time() if now_ts is None else now_ts
    local = datetime.fromtimestamp(now)
    next_five = local.replace(hour=DAY_START_HOUR, minute=0, second=0, microsecond=0)
    if next_five <= local:
        next_five += timedelta(days=1)
    wake = next_five.timestamp()
    async with get_db() as db:
        rows = await (await db.execute(
            "SELECT retry_after FROM memory_compression_schedule WHERE day=? "
            "AND status!='completed' AND attempts<?",
            (memory_day_for_ts(now), MAX_ATTEMPTS),
        )).fetchall()
    for row in rows:
        wake = min(wake, max(now + 1, float(row[0])))
    return max(1, wake - now)


async def auto_calendar_compression_loop():
    initialized = False
    try:
        while True:
            try:
                if not initialized:
                    await ensure_calendar_compression_schema()
                    await ensure_schedule_schema()
                    await recover_interrupted_jobs()
                    initialized = True
                await run_due_compression()
                delay = await next_check_delay()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Automatic memory compression scheduler failed")
                delay = 60  # Retry infrastructure failures without a busy loop.
            # Sleep until the next actual deadline, not a minute-by-minute DB scan.
            await asyncio.sleep(delay)
    finally:
        tasks = list(_ACTIVE_JOB_TASKS.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
