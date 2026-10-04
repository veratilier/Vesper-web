import json, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import vesper_wake_store as store
import vesper_wake_workflow as workflow
import vesper_wake_runner as runner
import vesper_wake_tools as permissions

class WorkflowTests(unittest.TestCase):
    def setUp(self):
        tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup)
        p=patch.object(store,'PATH',Path(tmp.name)/'wake.db');p.start();self.addCleanup(p.stop)
    def test_receipts_and_external_acceptance_are_distinct(self):
        saved=workflow.step('jotting_create',{'text':'secret','api_key':'secret'},{'jotting':{'id':'j1','text':'secret'}})
        self.assertEqual(saved['completion'],'completed')
        self.assertEqual(saved['references'],[{'kind':'jottings','id':'j1'}])
        accepted=workflow.step('call_configured_mcp_tool',{'arguments':{'token':'secret'}},{'token':'secret','accepted':True})
        self.assertEqual(accepted['completion'],'request_accepted')
        self.assertNotIn('secret',json.dumps([saved,accepted]))
    def test_history_pagination_and_old_results_are_not_rewritten(self):
        with store.db() as con:
            for i in range(3):
                con.execute('INSERT INTO jobs(id,source,due,status,created,finished,decision) VALUES(?,?,?,?,?,?,?)',(str(i),'automation',i,'silent',i,i,'nothing_to_share'))
            con.execute("INSERT INTO calls(job_id,item_id,status,name,result) VALUES('2','a','done','jotting_create','raw private result')")
        first=store.workflow_runs(2);second=store.workflow_runs(2,first['nextOffset'])
        self.assertEqual([x['id'] for x in first['jobs']+second['jobs']],['2','1','0'])
        old=first['jobs'][0]['calls'][0]
        self.assertEqual(old['completion'],'unknown')
        self.assertNotIn('raw private result',json.dumps(first))
        self.assertEqual(store.workflow_run('2')['job']['id'],'2')
        with self.assertRaises(ValueError):store.workflow_run('missing')
    def test_silent_and_partial_failure_are_readable(self):
        for status in ['started','failed']:
            call=dict(workflow.step('music_search',failed=True),name='music_search',status=status)
            result=workflow.describe({'status':'silent','decision':'nothing_to_share','notification':None},[call])
            self.assertEqual(result['outcome'],'partial_failure')
            self.assertTrue(result['silentReason'])
    def test_jotting_ids_are_stable_and_writes_require_authorization(self):
        a=permissions.tool_input('jotting_create',{'id':'model','text':'x'},'job','item',{})
        b=permissions.tool_input('jotting_create',{'id':'another','text':'x'},'job','item',{})
        self.assertEqual(a['id'],b['id'])
        self.assertNotIn('jotting_create',permissions.allowed_tools({'tools':[],'messages':[]},runner.ALLOWED))
    def test_context_has_times_one_previous_wake_and_reply_state(self):
        with store.db() as con:
            for ident,at in [('old',10),('latest',20)]:
                con.execute('INSERT INTO jobs(id,source,due,status,created,finished,conversation_id,notification) VALUES(?,?,?,?,?,?,?,?)',(ident,'automation',at,'completed',at,at,'chat',ident+' message'))
        rows=[{'id':'u','role':'user','created_at':'1970-01-01T00:00:30Z','content':'A current topic','vesper_conversation_id':'chat'}]
        with patch.object(runner.policy,'history',return_value=rows),patch.object(runner.policy,'normal',return_value=True),patch.object(runner.time,'time',return_value=100):
            value=json.loads(runner.context({'id':'new','conversation_id':'chat'}))
        self.assertEqual(value['lastWake']['id'],'latest')
        self.assertTrue(value['lastWake']['userRepliedSinceWake'])
        self.assertEqual(value['lastWake']['elapsedSeconds'],80)
        self.assertEqual(value['recentChat'][0]['at'],rows[0]['created_at'])
        self.assertNotIn('old message',json.dumps(value))
if __name__=='__main__':unittest.main()
