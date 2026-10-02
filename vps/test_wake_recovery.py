from itertools import count
import tempfile, time, unittest
from pathlib import Path
from unittest.mock import patch
import vesper_wake_recovery as recovery
import vesper_wake_runner as runner
import vesper_wake_store as store

class RecoveryTests(unittest.TestCase):
    def setUp(self):
        # Keep unrelated runner tests outside sleep hours; test_wake_sleep covers that gate.
        clock = patch('time.time', side_effect=count(1790827200, 0.001))  # 2026-10-01 12:00 Asia/Shanghai
        clock.start(); self.addCleanup(clock.stop)
        tmp = tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup)
        p = patch.object(store, 'PATH', Path(tmp.name) / 'wake.db');p.start();self.addCleanup(p.stop)

    def test_backoff_escalates_caps_and_deduplicates(self):
        state = {}
        for count, delay in enumerate([0, 0, 1800, 3600, 7200, 14400, 14400], 1):
            state = recovery.failure(state, str(count), 10000)
            self.assertEqual(state['failureCount'], count)
            self.assertEqual((state['retryAt'] or 10000) - 10000, delay)
            self.assertEqual(recovery.failure(state, str(count), 20000), state)
        self.assertEqual(recovery.success(state, 'ok')['failureCount'], 0)

    def test_persistent_pause_and_success_but_not_silence(self):
        for i in range(3):
            store.request(str(i))
            with store.db() as con:
                con.execute("UPDATE jobs SET status='failed',finished=? WHERE id=?", (time.time(), str(i)))
            runner.record_outcome(str(i))
        state = store.status()['recovery']
        self.assertTrue(state['paused']);self.assertIsNone(store.status()['nextAt'])
        with store.db() as reopened:self.assertEqual(store.get(reopened, 'recovery')['retryAt'], state['retryAt'])
        store.request('quiet')
        with store.db() as con:con.execute("UPDATE jobs SET status='silent' WHERE id='quiet'")
        runner.record_outcome('quiet');self.assertEqual(store.status()['recovery']['failureCount'], 3)
        with store.db() as con:con.execute("UPDATE jobs SET status='completed' WHERE id='quiet'")
        runner.record_outcome('quiet');self.assertEqual(store.status()['recovery']['failureCount'], 0)

    def test_paused_tick_never_queries_desire_or_runs_model(self):
        with store.db() as con:store.put(con, 'recovery', recovery.failure({'failureCount': 2}, 'third', time.time()))
        with patch.object(runner, 'http', return_value={'value': {}}), patch.object(runner, 'reschedule') as schedule, patch.object(runner, 'Rpc') as rpc:
            runner.tick();schedule.assert_not_called();rpc.assert_not_called()

    def test_expiry_runs_one_new_probe_not_the_failed_job(self):
        store.configure({'enabled': True, 'intervalMinutes': 60})
        with store.db() as con:store.put(con, 'recovery', {'failureCount': 3, 'lastEvent': 'failed-old', 'retryAt': time.time() - 1})
        def execute(job):runner.update(job['id'], status='silent', finished=time.time())
        with patch.object(runner, 'http', return_value={'value': {}}), patch.object(runner, 'reschedule'), patch.object(runner, 'current_preferences', return_value={}), patch.object(runner, 'front_busy', return_value=False), patch.object(runner.policy, 'history', return_value=[]), patch.object(runner.policy, 'target', return_value={'conversation_id':'test','user_message_id':'user','user_turn_id':'turn'}), patch.object(runner, 'execute', side_effect=execute) as run:
            runner.tick();runner.tick();self.assertEqual(run.call_count, 1)
            self.assertNotEqual(run.call_args.args[0]['id'], 'failed-old')

    def test_daily_budget_no_longer_blocks_execution(self):
        store.configure({'enabled': True, 'intervalMinutes': 60})
        with store.db() as con:
            for i in range(25):con.execute("INSERT INTO jobs(id,source,due,status,created,started,tokens,budget_tokens) VALUES(?,?,?,?,?,?,?,?)", (str(i), 'automation', 0, 'completed', 0, time.time(), 100000, 40000))
        store.request('new')
        def execute(job):runner.update(job['id'], status='completed', finished=time.time())
        with patch.object(runner, 'http', return_value={'value': {}}), patch.object(runner, 'reschedule'), patch.object(runner, 'current_preferences', return_value={}), patch.object(runner, 'front_busy', return_value=False), patch.object(runner.policy, 'history', return_value=[]), patch.object(runner.policy, 'target', return_value={'conversation_id':'test','user_message_id':'user','user_turn_id':'turn'}), patch.object(runner, 'execute', side_effect=execute) as run:
            runner.tick();run.assert_called_once()

    def test_quota_probe_reads_account_only_and_preserves_failed_count(self):
        now = time.time()
        with store.db() as con:store.put(con, 'recovery', {'reason':'quota','failureCount':4,'lastEvent':'failed','retryAt':now-1})
        calls = []
        class Rpc:
            def call(self, method, params):
                calls.append(method)
                if method == 'account/read':return {'account':{'type':'chatgpt'}}
                if method == 'account/rateLimits/read':return {'rateLimits':{'primary':{'usedPercent':100,'resetsAt':now+5000}}}
                return {}
            def send(self, msg):pass
            def close(self):pass
        with patch.object(runner, 'Rpc', Rpc):self.assertFalse(runner.recovery_ready(now))
        self.assertEqual(calls, ['initialize','account/read','account/rateLimits/read'])
        self.assertEqual(store.status()['recovery']['retryAt'], now+5000)
        self.assertEqual(store.status()['recovery']['failureCount'], 4)

    def test_check_request_never_queues_a_model_turn(self):
        store.request_health_check()
        self.assertEqual(store.status()['jobs'], [])
        with store.db() as con:self.assertTrue(store.get(con, 'health_check_requested'))

    def test_tools_have_independent_state_and_private_uncertainty_hashes(self):
        a=recovery.tool_key('call_configured_mcp_tool', {'connectionId':'a','toolName':'post'})
        b=recovery.tool_key('call_configured_mcp_tool', {'connectionId':'b','toolName':'read'})
        self.assertNotEqual(a,b)
        states={}
        for i in range(3):states[a]=recovery.failure(states.get(a), str(i), 1000)
        self.assertTrue(recovery.blocked(states[a], 1001));self.assertFalse(recovery.blocked(states.get(b), 1001))
        mark=recovery.fingerprint(a, {'private_body':'secret'})
        self.assertNotIn('secret', mark);self.assertEqual(len(mark),64)
        self.assertEqual(mark,recovery.fingerprint(a, {'private_body':'secret'}))

if __name__ == '__main__':unittest.main()
