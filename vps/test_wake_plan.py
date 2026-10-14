"""Regression checks for the current durable wake plan format."""
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import vesper_wake_plan as plan
import vesper_wake_store as store


class WakePlanTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        original = store.PATH
        store.PATH = Path(self.temp.name) / 'wake.sqlite3'
        self.addCleanup(lambda: setattr(store, 'PATH', original))

    def test_plan_is_bounded_and_saves_without_changing_owner_settings(self):
        now = 1_791_037_200.0
        ident = store.request('planned', source='automation')
        with store.db() as con:
            expected = store.planning_snapshot(con)
        choice = {'at': datetime.fromtimestamp(now + 3600, timezone.utc).isoformat(),
                  'task': '继续读那一页', 'reason': '想接着看'}
        self.assertEqual(store.save_agent_plan(ident, choice, '下次从书签继续。', expected, now, now), 'saved')
        with store.db() as con:
            saved = store.get(con, 'schedule')
            self.assertEqual(saved['task'], choice['task'])
            self.assertEqual(store.get(con, 'rowan_self_prompt'), '下次从书签继续。')
            self.assertEqual(store.planning_snapshot(con), expected)

    def test_owner_change_wins_over_model_plan(self):
        now = 1_791_037_200.0
        ident = store.request('owner-change', source='automation')
        with store.db() as con:
            expected = store.planning_snapshot(con)
            store.put(con, 'config', {'enabled': False, 'intervalMinutes': None})
        choice = {'at': datetime.fromtimestamp(now + 3600, timezone.utc).isoformat(),
                  'task': '继续读', 'reason': '想读'}
        self.assertEqual(store.save_agent_plan(ident, choice, None, expected, now, now), 'owner_settings_changed')
        with store.db() as con:
            self.assertIsNone(store.get(con, 'schedule'))

    def test_invalid_time_does_not_save_plan(self):
        now = 1_791_037_200.0
        ident = store.request('invalid-time', source='automation')
        with store.db() as con:
            expected = store.planning_snapshot(con)
        with self.assertRaisesRegex(ValueError, 'timezone'):
            store.save_agent_plan(ident, {'at': '2026-10-15T10:00:00', 'task': '读书', 'reason': '想读'},
                                  None, expected, now, now)
        with store.db() as con:
            self.assertIsNone(store.get(con, 'schedule'))


if __name__ == '__main__':
    unittest.main()
