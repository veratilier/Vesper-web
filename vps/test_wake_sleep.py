import importlib, tempfile, unittest
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
from unittest.mock import patch
import vesper_wake_store as store
import vesper_wake_sleep as sleep
import vesper_wake_runner as runner

def at(value):return datetime.fromisoformat(value).replace(tzinfo=ZoneInfo('Asia/Shanghai')).timestamp()

class SleepTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / 'wake.sqlite3'
        p = patch.object(store, 'PATH', self.path); p.start(); self.addCleanup(p.stop)
        self.noon = at('2026-10-01T12:00:00')
        p = patch('time.time', return_value=self.noon); self.clock = p.start(); self.addCleanup(p.stop)
        store.configure({'enabled': True, 'intervalMinutes': 60})
    def test_midnight_and_morning_boundaries(self):
        self.assertIsNone(sleep.window(sleep.DEFAULT, at('2026-10-01T23:59:59')))
        night = sleep.window(sleep.DEFAULT, at('2026-10-02T00:00:00'))
        self.assertEqual(night['end'], at('2026-10-02T07:00:00'))
        self.assertIsNotNone(sleep.window(sleep.DEFAULT, at('2026-10-02T06:59:59')))
        self.assertIsNone(sleep.window(sleep.DEFAULT, at('2026-10-02T07:00:00')))
        custom = dict(sleep.DEFAULT, start='23:00', end='08:00')
        self.assertEqual(sleep.window(custom, at('2026-10-02T02:00:00'))['start'], at('2026-10-01T23:00:00'))
        self.assertIsNone(sleep.window(dict(custom, enabled=False), at('2026-10-02T02:00:00')))
    def test_settings_validation_readback_and_restart(self):
        custom = dict(sleep.DEFAULT, start='23:30', end='08:15')
        store.configure({'enabled': True, 'intervalMinutes': 90, 'sleep': custom})
        # Old clients saving permissions cannot erase the new sleep preference.
        store.configure({'enabled': True, 'intervalMinutes': 90, 'permissions': store.access()})
        self.assertEqual(store.status()['config']['sleep'], custom)
        importlib.reload(runner)
        self.assertEqual(store.status()['config']['sleep'], custom)
        for invalid in [dict(custom,start='24:00'),dict(custom,end='23:30'),dict(custom,timeZone='unknown'),dict(custom,enabled=1)]:
            with self.assertRaises(ValueError):store.configure({'enabled': False, 'intervalMinutes': 60, 'sleep': invalid})
        self.assertTrue(store.status()['enabled'])
    def test_sleep_tick_and_notification_use_no_network_or_model(self):
        self.clock.return_value = at('2026-10-02T01:00:00')
        store.request('pending', source='automation')
        with patch.object(runner,'http',side_effect=AssertionError('No night HTTP')), patch.object(runner,'Rpc',side_effect=AssertionError('No night model')):
            runner.tick(); runner.deliver('pending', 'test'); runner.reschedule()
        state = store.status()
        self.assertTrue(state['sleep']['sleeping'])
        self.assertEqual(state['nextAt'], at('2026-10-02T07:00:00'))
        self.assertEqual(state['lastJob']['status'], 'silent')
        with store.db() as con:self.assertEqual(con.execute('SELECT count(*) FROM sleep_cycles').fetchone()[0],1)
    def observed_night(self):
        self.clock.return_value = at('2026-10-02T02:00:00'); runner.sleep_gate(self.clock.return_value)
        self.clock.return_value = at('2026-10-02T07:00:00')
    def test_morning_saved_once_even_after_restart(self):
        self.observed_night()
        def save(path,body):
            args=body['arguments']; self.assertEqual(args['kind'],'dream')
            return {'result': {'stored':True,'storage':'shared_memory','memory': {'id':'dream-test','kind':'dream','body':args['body']}}}
        with patch.object(runner,'generate_dream',return_value='【模拟梦境】test') as generate, patch.object(runner,'http',side_effect=save) as request:
            runner.finish_sleep(self.clock.return_value); runner.finish_sleep(self.clock.return_value)
            self.assertEqual(generate.call_count,1); self.assertEqual(request.call_count,1)
        importlib.reload(runner)
        with patch.object(runner,'http',side_effect=AssertionError('Do not duplicate')):runner.finish_sleep(self.clock.return_value)
        self.assertEqual(store.status()['sleep']['lastDream']['status'],'saved')
    def test_uncertain_write_retries_same_persisted_body(self):
        self.observed_night()
        with patch.object(runner,'generate_dream',return_value='【模拟梦境】same') as generate, patch.object(runner,'http',side_effect=TimeoutError):
            runner.finish_sleep(self.clock.return_value); self.assertEqual(generate.call_count,1)
        self.clock.return_value += 1801
        def save(path,body):return {'result': {'stored':True,'storage':'shared_memory','memory': {'id':'deduplicated','kind':'dream','body':body['arguments']['body']}}}
        with patch.object(runner,'generate_dream',side_effect=AssertionError('Never regenerate after uncertain write')), patch.object(runner,'http',side_effect=save):runner.finish_sleep(self.clock.return_value)
        self.assertEqual(store.status()['sleep']['lastDream']['status'],'saved')
    def test_switch_and_permission_revocation_block_dream(self):
        self.observed_night()
        with patch.object(runner,'generate_dream',side_effect=AssertionError('Must not generate')):
            store.configure({'enabled':False,'intervalMinutes':60}); runner.finish_sleep(self.clock.return_value)
            store.configure({'enabled':True,'intervalMinutes':60,'sleep':dict(sleep.DEFAULT,dreamEnabled=False)}); runner.finish_sleep(self.clock.return_value)
            store.configure({'enabled':True,'intervalMinutes':60,'sleep':sleep.DEFAULT,'permissions': {'tools': [],'messages':[]}}); runner.finish_sleep(self.clock.return_value)
    def test_running_turn_crossing_midnight_cannot_write_or_send(self):
        self.clock.return_value = at('2026-10-01T23:59:59')
        store.request('running', source='automation')
        job = {'id':'running','source':'automation','conversation_id':'chat','user_message_id':'user'}
        owner = self
        class RPC:
            handler = None
            def call(self, method, params):
                if method == 'account/read':return {'account':{'type':'chatgpt'}}
                if method == 'thread/start':return {'thread':{'id':'thread'}}
                if method == 'turn/start':return {'turn':{'id':'turn'}}
                return {}
            def send(self,msg):pass
            def next(self,timeout):
                owner.clock.return_value = at('2026-10-02T00:00:00')
                return {'method':'item/completed','params':{'item':{'type':'agentMessage','text':'{}'}}}
            def close(self):pass
        calls = []
        def http(path,body=None,**kwargs):
            if body is None:return {'tools':[{'name':'desire_status'},{'name':'desire_encounter'}]}
            calls.append(body); return {'result':{'longing':22}}
        with patch.object(runner,'Rpc',RPC), patch.object(runner,'http',side_effect=http), patch.object(runner,'recent_chat',return_value=False), patch.object(runner,'context',return_value=''), patch.object(runner,'current_preferences',return_value={}), patch.object(runner,'front_busy',return_value=False), patch.object(runner.policy,'normal',return_value=True), patch.object(runner.policy,'history',return_value=[{'id':'user','vesper_conversation_id':'chat'}]):
            runner.execute(job)
        self.assertEqual([c['name'] for c in calls], ['desire_status'])
        self.assertEqual(store.status()['lastJob']['decision'],'sleep_time')

    def test_dream_quota_failure_uses_existing_health_gate(self):
        self.observed_night()
        with patch.object(runner,'generate_dream',side_effect=RuntimeError('usage limit reached')):
            runner.finish_sleep(self.clock.return_value)
        self.assertEqual(store.status()['recovery']['reason'], 'quota')
        self.assertTrue(store.status()['recovery']['paused'])

    def test_no_retroactive_dream_when_deployed_after_sleep(self):
        with patch.object(runner,'generate_dream',side_effect=AssertionError('Unobserved night')):runner.finish_sleep(self.noon)

if __name__ == '__main__':unittest.main()
