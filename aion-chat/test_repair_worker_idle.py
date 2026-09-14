import asyncio
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import repair_worker as worker
from repair_store import RepairStore


class IdleWorkerTests(unittest.TestCase):
    def test_idle_worker_exits_and_heartbeats_are_throttled(self):
        clock = [0]
        async def sleep(seconds):
            clock[0] += seconds
        store = Mock()
        store.claim.return_value = None
        with patch.object(worker, 'time', SimpleNamespace(monotonic=lambda: clock[0], time=lambda: clock[0]+1000)), patch.object(worker.asyncio, 'sleep', sleep):
            asyncio.run(worker.run(store))
        self.assertEqual(clock[0], 60)
        self.assertEqual(store.runtime.call_count, 13)

    def test_submission_during_idle_exit_relaunches_after_releasing_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            store = RepairStore(Path(directory))
            task = store.create('test')
            async def exit_with_late_submission(store):
                store.enqueue(task['id'], 'discuss', {'text':'late request'})
            with patch.object(worker, 'default_store', return_value=store), patch.object(worker, 'run', exit_with_late_submission), patch.object(worker, 'ensure_worker') as launch:
                worker.main()
            launch.assert_called_once_with(store)
            self.assertEqual(float(store.runtime('heartbeat')), 0)
            self.assertIsNotNone(store.claim())
