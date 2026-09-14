import json, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import vesper_wake_store as store
import vesper_wake_runner as runner

class RequiredDesireTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        p=patch.object(store,'PATH',Path(self.tmp.name)/'wake.db');p.start();self.addCleanup(p.stop)
        store.request('test',source='automation')
        self.job={'id':'test','source':'automation','conversation_id':'chat','user_message_id':'user'}
        self.calls=[]
    def execute(self, assessment, fail_write=False):
        owner=self
        class RPC:
            handler=None
            def call(self,method,params):
                if method=='account/read':return {'account':{'type':'chatgpt'}}
                if method=='thread/start':return {'thread':{'id':'thread'}}
                if method=='turn/start':
                    self.handler({'method':'item/completed','params':{'item':{'type':'agentMessage','text':json.dumps({'share':False,'message':'','desire':assessment})}}})
                    self.handler({'method':'turn/completed','params':{'turn':{'status':'completed'}}})
                    return {'turn':{'id':'turn'}}
                return {}
            def send(self,p):pass
            def close(self):pass
        def http(path,body=None,**kwargs):
            if body is None:return {'tools':[{'name':'desire_status'},{'name':'desire_encounter'}]}
            owner.calls.append(body)
            return {'result':{'isError':True} if fail_write and body['name']=='desire_encounter' else {'longing':22}}
        with patch.object(runner,'Rpc',RPC),patch.object(runner,'http',side_effect=http),patch.object(runner,'context',return_value='Visible context'),patch.object(runner,'current_preferences',return_value={}),patch.object(runner,'front_busy',return_value=False),patch.object(runner.policy,'history',return_value=[{'id':'user','vesper_conversation_id':'chat'}]),patch.object(runner.policy,'normal',return_value=True):
            runner.execute(self.job)
    def test_silent_run_still_reads_then_writes_note(self):
        self.execute({'kind':'absence','note':'A current observation.'})
        self.assertEqual([c['name'] for c in self.calls],['desire_status','desire_encounter'])
        args=self.calls[-1]['arguments']
        self.assertEqual(args['interaction_source'],'automation')
        self.assertEqual(args['note'],'A current observation.')
        self.assertTrue(args['request_id'].startswith('wake-'))
        with store.db() as con:self.assertEqual(con.execute("SELECT status FROM jobs WHERE id='test'").fetchone()[0],'silent')
    def test_missing_note_cannot_complete_or_write(self):
        with self.assertRaises(RuntimeError):self.execute({'kind':'absence','note':''})
        self.assertEqual(len(self.calls),1)
    def test_failed_write_cannot_mark_run_successful(self):
        with self.assertRaises(RuntimeError):self.execute({'kind':'absence','note':'Current thought.'},True)
        with store.db() as con:
            self.assertEqual(con.execute("SELECT status FROM calls WHERE item_id='required-desire-encounter'").fetchone()[0],'failed')
            self.assertNotEqual(con.execute("SELECT status FROM jobs WHERE id='test'").fetchone()[0],'silent')
    def test_revoked_permission_is_not_bypassed(self):
        with store.db() as con:store.put(con,'permissions',{'tools':['desire_status'],'messages':[]})
        with self.assertRaisesRegex(RuntimeError,'permission'):self.execute({'kind':'absence','note':'Current thought.'})
        self.assertEqual(self.calls,[])

if __name__=='__main__':unittest.main()
