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
        self.calls=[];self.messages=[]
    def execute(self, assessment, fail_write=False, share=True, message="A real observation."):
        owner=self
        class RPC:
            handler=None
            def call(self,method,params):
                if method=='account/read':return {'account':{'type':'chatgpt'}}
                if method=='thread/start':return {'thread':{'id':'thread'}}
                if method=='turn/start':
                    self.handler({'method':'item/completed','params':{'item':{'type':'agentMessage','text':json.dumps({'share':share,'message':message,'desire':assessment})}}})
                    self.handler({'method':'turn/completed','params':{'turn':{'status':'completed'}}})
                    return {'turn':{'id':'turn'}}
                return {}
            def send(self,p):pass
            def close(self):pass
        def http(path,body=None,**kwargs):
            if path.endswith('/messages'):
                owner.messages.append(body);return {}
            if path=='/api/wake':return {'delivered':1}
            if body is None:return {'tools':[{'name':'desire_status'},{'name':'desire_encounter'}]}
            owner.calls.append(body)
            return {'result':{'isError':True} if fail_write and body['name']=='desire_encounter' else {'longing':22}}
        with patch.object(runner,'Rpc',RPC),patch.object(runner,'http',side_effect=http),patch.object(runner,'context',return_value='Visible context'),patch.object(runner,'current_preferences',return_value={}),patch.object(runner,'front_busy',return_value=False),patch.object(runner.policy,'history',return_value=[{'id':'user','vesper_conversation_id':'chat'}]),patch.object(runner.policy,'normal',return_value=True):
            runner.execute(self.job)
    def test_active_run_reads_writes_then_sends_message(self):
        self.execute({'kind':'absence','note':'A current observation.'})
        self.assertEqual([c['name'] for c in self.calls],['desire_status','desire_encounter'])
        self.assertEqual(len(self.messages),1)
        self.assertEqual(self.messages[0]['content'],'A real observation.')
        args=self.calls[-1]['arguments']
        self.assertEqual(args['interaction_source'],'automation')
        self.assertEqual(args['note'],'A current observation.')
        self.assertTrue(args['request_id'].startswith('wake-'))
        with store.db() as con:self.assertEqual(con.execute("SELECT status FROM jobs WHERE id='test'").fetchone()[0],'completed')
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

    def test_recent_chat_is_silent_without_any_rpc_or_write(self):
        with patch.object(runner, 'recent_chat', return_value=True), patch.object(runner, 'Rpc') as rpc, patch.object(runner, 'http') as http:
            runner.execute(self.job)
            rpc.assert_not_called();http.assert_not_called()
        with store.db() as con:
            self.assertEqual(con.execute("SELECT decision FROM jobs WHERE id='test'").fetchone()[0], 'recent_user_activity')

    def test_empty_or_silent_active_response_cannot_write_or_publish(self):
        for share,message in [(False,''),(True,'   '),(False,'text'),(True,'x'*401)]:
            with self.assertRaisesRegex(RuntimeError,'nonempty chat'):
                self.execute({'kind':'absence','note':'Real observation'},share=share,message=message)
        self.assertEqual(self.messages,[])
        self.assertTrue(all(c['name']=='desire_status' for c in self.calls))

    def test_user_returns_before_desire_write_blocks_publication(self):
        with patch.object(runner, 'recent_chat', side_effect=[False,False,True]):
            self.execute({'kind':'absence','note':'Observation'})
        self.assertEqual([c['name'] for c in self.calls],['desire_status'])
        self.assertEqual(self.messages,[])

    def test_disabled_text_permission_prevents_model_and_desire(self):
        with store.db() as con:store.put(con,'permissions',{'tools':['desire_status','desire_encounter'],'messages':[]})
        with self.assertRaisesRegex(RuntimeError,'message permission'):
            self.execute({'kind':'absence','note':'Observation'})
        self.assertEqual(self.calls,[])

if __name__=='__main__':unittest.main()
