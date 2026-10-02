from itertools import count
import tempfile, time, unittest
from pathlib import Path
from unittest.mock import patch
import vesper_wake_store as store
import vesper_wake_runner as runner

class WakeControlsTests(unittest.TestCase):
    def setUp(self):
        # Keep unrelated runner tests outside sleep hours; test_wake_sleep covers that gate.
        clock = patch('time.time', side_effect=count(1790827200, 0.001))  # 2026-10-01 12:00 Asia/Shanghai
        clock.start(); self.addCleanup(clock.stop)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        patcher = patch.object(store, 'PATH', Path(tmp.name) / 'wake.db')
        patcher.start(); self.addCleanup(patcher.stop)

    def test_disable_cancels_queued_automatic_only(self):
        store.request('automatic', source='automation')
        state = store.configure({'enabled': False, 'intervalMinutes': 60})
        self.assertFalse(state['enabled'])
        self.assertEqual(state['jobs'][0]['status'], 'cancelled')
        store.request('manual')
        state = store.configure({'enabled': False, 'intervalMinutes': 60})
        self.assertEqual(state['jobs'][0]['status'], 'queued')

    def test_fixed_interval_is_durable_and_needs_no_desire(self):
        store.configure({'enabled': True, 'intervalMinutes': 240})
        store.request('finished')
        with store.db() as con:
            con.execute("UPDATE jobs SET status='completed',finished=? WHERE id='finished'", (time.time(),))
        with patch.object(runner, 'http', side_effect=AssertionError('Fixed interval must not query Desire')):
            runner.reschedule('finished')
        state = store.status()
        self.assertEqual(state['config']['intervalMinutes'], 240)
        self.assertAlmostEqual(state['nextAt'] - time.time(), 14400, delta=2)
        original = state['nextAt']
        runner.reschedule('finished')
        self.assertEqual(store.status()['nextAt'], original)

    def test_invalid_config_does_not_change_saved_settings(self):
        store.configure({'enabled': True, 'intervalMinutes': 60})
        for value in [True, 0, 29, 1441, '60', 60.5]:
            with self.assertRaises(ValueError):
                store.configure({'enabled': False, 'intervalMinutes': value})
        self.assertTrue(store.status()['enabled'])
        self.assertEqual(store.status()['config']['intervalMinutes'], 60)

    def test_prompt_is_durable_and_editing_preserves_next_wake(self):
        store.configure({'enabled': True, 'intervalMinutes': 60})
        next_at = store.status()['nextAt']
        text = '先看看书，再留一句话。\n不要重复问候。'
        state = store.configure({'enabled': True, 'intervalMinutes': 60, 'prompt': text})
        self.assertEqual(store.task_prompt(), text)
        self.assertEqual(state['prompt'], text)
        self.assertEqual(state['nextAt'], next_at)
        # Older clients can still change the interval without erasing the prompt.
        store.configure({'enabled': True, 'intervalMinutes': 120})
        self.assertEqual(store.task_prompt(), text)
        store.configure({'enabled': True, 'intervalMinutes': 120, 'prompt': state['defaultPrompt']})
        self.assertEqual(store.task_prompt(), store.DEFAULT_PROMPT)

    def test_bad_prompt_rejected_atomically(self):
        store.configure({'enabled': True, 'intervalMinutes': 60, 'prompt': '保留这段文字'})
        for value in ['', '  ', None, 123, 'a' * 8001]:
            with self.assertRaises(ValueError):
                store.configure({'enabled': False, 'intervalMinutes': 120, 'prompt': value})
        self.assertEqual(store.task_prompt(), '保留这段文字')
        self.assertTrue(store.status()['enabled'])
        self.assertEqual(store.status()['config']['intervalMinutes'], 60)

    def test_history_is_bounded_and_omits_raw_content(self):
        with store.db() as con:
            for i in range(55):
                con.execute("INSERT INTO jobs(id,source,due,status,created,notification,error) VALUES(?,?,?,?,?,?,?)",
                            (str(i), 'automation', i, 'completed', i, 'private reply', 'private error'))
            con.execute("INSERT INTO calls(job_id,item_id,status,result,name) VALUES('54','tool','done','private result','atlas_note_list')")
        state = store.status()
        self.assertEqual(len(state['jobs']), 50)
        self.assertEqual(state['jobs'][0]['id'], '54')
        self.assertEqual(state['jobs'][0]['calls'][0]['name'], 'atlas_note_list')
        # 10b0f68 intentionally exposes the sent notification in the owner's ledger.
        self.assertEqual(state['jobs'][0]['notification'], 'private reply')
        self.assertNotIn('private error', str(state))
        self.assertNotIn('private result', str(state))

if __name__ == '__main__': unittest.main()
