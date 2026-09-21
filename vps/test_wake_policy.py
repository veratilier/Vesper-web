import json,random,sqlite3,tempfile,unittest
from pathlib import Path
from datetime import datetime,timezone
from unittest.mock import patch
import vesper_wake_policy as policy
import vesper_wake_store as store
import vesper_wake_runner as runner

def row(ident,role='user',turn='normal',conv='chat',at=1000,**meta):
    return {'id':ident,'role':role,'content':'你好','status':'completed' if role=='user' else 'delivered',
      'turn_id':turn,'vesper_conversation_id':conv,'created_at':datetime.fromtimestamp(at,timezone.utc).isoformat(),
      'metadata_json':json.dumps(meta),'message_type':'text'}

class PolicyTests(unittest.TestCase):
    def test_select_completed_pair_not_wakes_tests_or_unfinished(self):
        rows=[row('pending',turn='pending',at=5000),row('test',turn='test',at=4000,test=True),
              row('test-answer','agent','test',at=4001),row('wake',at=3000,wakeRunId='wake'),
              row('valid',at=2000),row('answer','agent',at=2001),row('old',turn='old',conv='other')]
        self.assertEqual(policy.target(rows)['user_message_id'],'valid')
        self.assertIsNone(policy.target(rows[:4]))
    def test_no_quoted_or_inferred_preferences_and_expiry(self):
        quiet=row('quiet',at=1000);quiet['content']='请不要打扰我，2小时'
        self.assertIn('quiet',policy.preferences([quiet],1100))
        self.assertNotIn('quiet',policy.preferences([quiet],8201))
        quoted={**quiet,'content':'如果我说“不要打扰我”，会怎样？'}
        self.assertEqual(policy.preferences([quoted],1100),{})
        allow=row('allow',at=1200);allow['content']='现在可以找我'
        self.assertNotIn('quiet',policy.preferences([allow,quiet],1300))
        self.assertEqual(policy.preferences([row('silent')],1100),{})
    def test_token_budget_distinguishes_repeated_cached_input(self):
        self.assertEqual(runner.token_budget({'totalTokens':34247,'cachedInputTokens':16640}),(34247,17607))
        self.assertEqual(runner.token_budget({'totalTokens':33000}),(33000,33000))

    def test_interval_bounds_and_longing_direction(self):
        low=[policy.interval(0,{},random.Random(n)) for n in range(100)]
        high=[policy.interval(100,{},random.Random(n)) for n in range(100)]
        self.assertTrue(all(1800<=n<=7200 for n in low+high))
        self.assertGreater(min(low),max(high))
    def test_schedule_survives_reopen_and_never_redraws_same_round(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(store,'PATH',Path(tmp)/'wake.db'),patch.object(runner,'current_preferences',lambda:{}),patch.object(runner,'http',return_value={'result':{'state':{'longing':18}}}) as read:
            ident=store.request('one');runner.reschedule(ident)
            with store.db() as con:first=(store.get(con,'next_at'),store.get(con,'schedule'))
            runner.reschedule(ident);runner.reschedule()
            with store.db() as con:self.assertEqual(first,(store.get(con,'next_at'),store.get(con,'schedule')))
            self.assertEqual(read.call_count,1)
            self.assertTrue(1800<=first[1]['seconds']<=7200)
    def test_quiet_and_busy_prevent_claim_without_redraw(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(store,'PATH',Path(tmp)/'wake.db'),patch.object(runner,'reschedule'),patch.object(runner,'http',return_value={'value':{}}),patch.object(runner,'current_preferences',return_value={'quiet':{'expiresAt':9999999999}}),patch.object(runner,'execute') as execute:
            store.request('quiet')
            with store.db() as con:store.put(con,'next_at',12345)
            runner.tick();runner.tick()
            execute.assert_not_called()
            with store.db() as con:
                self.assertEqual(store.get(con,'next_at'),12345)
                self.assertEqual(con.execute('SELECT status FROM jobs').fetchone()[0],'queued')

    def test_night_claims_due_job_and_preserves_target(self):
        class Night(datetime):
            @classmethod
            def now(cls,tz=None):return datetime(2026,9,10,2,tzinfo=tz)
        selected={'conversation_id':'chat','user_message_id':'real-user','user_turn_id':'turn'}
        with tempfile.TemporaryDirectory() as tmp,patch.object(store,'PATH',Path(tmp)/'wake.db'),patch.object(runner,'reschedule'),patch.object(runner,'http',return_value={'value':{'careFrequency':'daily'}}),patch.object(runner,'current_preferences',return_value={}),patch.object(runner,'front_busy',return_value=False),patch.object(policy,'history',return_value=[]),patch.object(policy,'target',return_value=selected),patch.object(runner,'datetime',Night),patch.object(runner,'execute') as execute:
            with store.db() as con:store.put(con,'next_at',1)
            runner.tick();runner.tick()
            execute.assert_called_once()
            self.assertEqual(execute.call_args.args[0]['conversation_id'],'chat')

    def test_no_target_skips_without_creating_conversation_or_running_model(self):
        class Day(datetime):
            @classmethod
            def now(cls,tz=None):return datetime(2026,9,9,12,tzinfo=tz)
        with tempfile.TemporaryDirectory() as tmp,patch.object(store,'PATH',Path(tmp)/'wake.db'),patch.object(runner,'reschedule'),patch.object(runner,'http',return_value={'value':{'careFrequency':'off'}}),patch.object(runner,'current_preferences',return_value={}),patch.object(runner,'front_busy',return_value=False),patch.object(policy,'history',return_value=[]),patch.object(runner,'datetime',Day),patch.object(runner,'execute') as execute:
            store.request('no-target');runner.tick();execute.assert_not_called()
            with store.db() as con:
                job=con.execute('SELECT * FROM jobs').fetchone()
                self.assertEqual(job['status'],'skipped');self.assertIsNone(job['conversation_id'])

    def test_history_refuses_background_recreation_of_missing_window(self):
        import codex_history_server as history
        with tempfile.TemporaryDirectory() as tmp,patch.object(history,'DB_PATH',Path(tmp)/'history.db'):
            handler=object.__new__(history.Handler)
            handler.body=lambda:{'id':'wake-final','role':'agent','content':'Actual result','wakeTargetUserId':'deleted-user'}
            responses=[];handler.send_json=lambda status,body:responses.append(status)
            handler.upsert_message('missing-chat')
            self.assertEqual(responses,[409])
            with history.db() as con:self.assertEqual(con.execute('SELECT count(*) FROM conversations').fetchone()[0],0)

if __name__=='__main__':unittest.main()
