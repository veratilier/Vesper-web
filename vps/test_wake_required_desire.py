from itertools import count
import json, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import vesper_wake_store as store
import vesper_wake_runner as runner

def assert_strict_output_schema(schema):
    # Model provider rejects optional object properties before generating tokens.
    if schema.get('type')=='object':
        if set(schema.get('required',[])) != set(schema['properties']) or schema.get('additionalProperties') is not False:
            raise ValueError('invalid_json_schema: every property must be required')
        for child in schema['properties'].values():assert_strict_output_schema(child)
    for child in schema.get('anyOf',[]):assert_strict_output_schema(child)

class RequiredDesireTests(unittest.TestCase):
    def setUp(self):
        # Keep unrelated runner tests outside sleep hours; test_wake_sleep covers that gate.
        clock = patch('time.time', side_effect=count(1790827200, 0.001))  # 2026-10-01 12:00 Asia/Shanghai
        clock.start(); self.addCleanup(clock.stop)
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        p=patch.object(store,'PATH',Path(self.tmp.name)/'wake.db');p.start();self.addCleanup(p.stop)
        store.request('test',source='automation')
        self.job={'id':'test','source':'automation','conversation_id':'chat','user_message_id':'user'}
        self.calls=[];self.messages=[]
    def execute(self, assessment, fail_write=False, fail_read=False, share=True, message="A real observation.", turn_error=None):
        owner=self
        class RPC:
            handler=None
            def call(self,method,params):
                if method=='account/read':return {'account':{'type':'chatgpt'}}
                if method=='thread/start':return {'thread':{'id':'thread'}}
                if method=='turn/start':
                    assert_strict_output_schema(params['outputSchema'])
                    owner.schema=params['outputSchema']
                    if turn_error:
                        self.handler({'method':'turn/completed','params':{'turn':{'status':'failed','error':turn_error}}})
                    else:
                        self.handler({'method':'item/completed','params':{'item':{'type':'agentMessage','text':json.dumps({'share':share,'message':message,'silentReason':'' if share else 'Nothing new to share','desire':assessment})}}})
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
            return {'result':{'isError':True} if (fail_write and body['name']=='desire_encounter') or (fail_read and body['name']=='desire_status') else {'longing':22}}
        with patch.object(runner,'Rpc',RPC),patch.object(runner,'http',side_effect=http),patch.object(runner,'context',return_value='Visible context'),patch.object(runner,'current_preferences',return_value={}),patch.object(runner,'front_busy',return_value=False),patch.object(runner.policy,'history',return_value=[{'id':'user','vesper_conversation_id':'chat'}]),patch.object(runner.policy,'normal',return_value=True):
            runner.execute(self.job)
    def test_active_run_reads_writes_then_sends_message(self):
        self.execute({'kind':'absence','note':'A current observation.'})
        self.assertEqual([c['name'] for c in self.calls],['desire_status'])
        self.assertEqual(len(self.messages),1)
        self.assertEqual(self.messages[0]['content'],'A real observation.')
        self.assertNotIn('desire',self.schema['properties'])
        with store.db() as con:self.assertEqual(con.execute("SELECT status FROM jobs WHERE id='test'").fetchone()[0],'completed')

    def test_no_observation_uses_nullable_desire_without_writing(self):
        self.execute(None,share=False,message='')
        self.assertEqual([c['name'] for c in self.calls],['desire_status'])
        self.assertEqual(self.messages,[])
        self.assertNotIn('desire',self.schema['properties'])
        self.assertEqual(store.status()['jobs'][0]['status'],'silent')

    def test_provider_schema_failure_keeps_specific_cause_and_cannot_publish(self):
        error={'message':json.dumps({'error':{'code':'invalid_json_schema','message':"Missing 'silentReason'."}})}
        with self.assertRaisesRegex(RuntimeError,"invalid_json_schema: Missing 'silentReason'"):
            self.execute(None,turn_error=error)
        self.assertEqual(self.messages,[])
        self.assertEqual([c['name'] for c in self.calls],['desire_status'])

    def test_provider_gate_rejects_old_optional_properties(self):
        for with_desire in [False,True]:
            schema=runner.wake_output_schema(with_desire)
            assert_strict_output_schema(schema)
            schema['required'].remove('silentReason')
            with self.assertRaisesRegex(ValueError,'invalid_json_schema'):assert_strict_output_schema(schema)
        schema=runner.wake_output_schema(True)
        schema['required'].remove('desire')
        with self.assertRaisesRegex(ValueError,'invalid_json_schema'):assert_strict_output_schema(schema)

    def test_specific_turn_errors_still_use_existing_quota_and_login_gates(self):
        for message,reason in [('Usage limit reached','quota'),('401 unauthorized','authentication')]:
            self.assertEqual(runner.recovery.kind(runner.turn_error_detail({'error':{'message':message}})),reason)
    def test_failed_internal_read_does_not_block_chat_or_claim_success(self):
        self.execute(None,fail_read=True)
        self.assertEqual([c['name'] for c in self.calls],['desire_status'])
        self.assertEqual(len(self.messages),1)
        self.assertEqual(store.status()['jobs'][0]['outcome'],'partial_failure')

    def test_legacy_candidate_is_not_written_by_activity_executor(self):
        self.execute({'kind':'absence','note':''})
        self.assertEqual([c['name'] for c in self.calls],['desire_status'])
        self.assertEqual(len(self.messages),1)

    def test_revoked_desire_permission_is_not_bypassed(self):
        with store.db() as con:store.put(con,'permissions',{'tools':['desire_status'],'messages':[]})
        self.execute({'kind':'absence','note':'Current thought.'})
        self.assertEqual([c['name'] for c in self.calls],['desire_status'])
        self.assertEqual(self.messages,[])

    def test_recent_chat_allows_read_and_activity_decision_but_no_message(self):
        with patch.object(runner,'recent_chat',return_value=True):self.execute(None)
        self.assertEqual([c['name'] for c in self.calls],['desire_status'])
        self.assertEqual(self.messages,[])
        self.assertEqual(store.status()['jobs'][0]['status'],'silent')

    def test_silent_response_records_desire_without_chat(self):
        self.execute({'kind':'absence','note':'Real observation'},share=False,message='')
        self.assertEqual([c['name'] for c in self.calls],['desire_status'])
        self.assertEqual(self.messages,[])
        self.assertEqual(store.status()['jobs'][0]['status'],'silent')
        self.assertTrue(store.status()['jobs'][0]['silentReason'])

    def test_invalid_shared_message_cannot_publish(self):
        for message in ['   ','x'*401]:
            with self.assertRaisesRegex(RuntimeError,'nonempty chat'):
                self.execute({'kind':'absence','note':'Real observation'},message=message)
        self.assertEqual(self.messages,[])

    def test_no_tools_no_desire_and_no_message_is_valid(self):
        with store.db() as con:store.put(con,'permissions',{'tools':[],'messages':[]})
        self.execute(None,share=False,message='')
        self.assertEqual(self.calls,[])
        self.assertEqual(self.messages,[])
        self.assertEqual(store.status()['jobs'][0]['status'],'silent')

    def test_user_returns_before_desire_write_blocks_publication(self):
        with patch.object(runner, 'recent_chat', side_effect=lambda values=iter([False,False,True]):next(values,True)):
            self.execute({'kind':'absence','note':'Observation'})
        self.assertEqual([c['name'] for c in self.calls],['desire_status'])
        self.assertEqual(self.messages,[])

    def test_disabled_text_permission_does_not_block_internal_assessment(self):
        with store.db() as con:store.put(con,'permissions',{'tools':['desire_status'],'messages':[]})
        self.execute({'kind':'absence','note':'Observation'})
        self.assertEqual([c['name'] for c in self.calls],['desire_status'])
        self.assertEqual(self.messages,[])

class ExternalRecoveryTests(unittest.TestCase):
    def setUp(self):
        # Keep unrelated runner tests outside sleep hours; test_wake_sleep covers that gate.
        clock = patch('time.time', side_effect=count(1790827200, 0.001))  # 2026-10-01 12:00 Asia/Shanghai
        clock.start(); self.addCleanup(clock.stop)

    setUp = RequiredDesireTests.setUp
    def test_uncertain_external_write_is_not_repeated_across_rounds(self):
        owner=self; external_calls=[]
        with store.db() as con:store.put(con, 'authorized_forum_connections', ['forum'])
        class RPC:
            handler=None
            def call(self,method,params):
                if method=='account/read':return {'account':{'type':'chatgpt'}}
                if method=='thread/start':return {'thread':{'id':'thread'}}
                if method=='turn/start':
                    for item,name,args in [('catalog','list_configured_mcp_tools',{}),('post','call_configured_mcp_tool',{'connectionId':'forum','toolName':'post','arguments':{'text':'private test note'}})]:
                        self.handler({'id':item,'method':'tool/call','params':{'name':name,'arguments':args}})
                    self.handler({'method':'item/completed','params':{'item':{'type':'agentMessage','text':json.dumps({'share':True,'message':'A current observation','desire':{'kind':'absence','note':'Current thought'}})}}})
                    self.handler({'method':'turn/completed','params':{'turn':{'status':'completed'}}})
                    return {'turn':{'id':'turn'}}
                return {}
            def send(self,p):pass
            def close(self):pass
        def http(path,body=None,**kwargs):
            if path.endswith('/messages'):owner.messages.append(body);return {}
            if path=='/api/wake':return {'delivered':1}
            if body is None:return {'tools':[{'name':n} for n in ['desire_status','desire_encounter','list_configured_mcp_tools','call_configured_mcp_tool']]}
            if body['name']=='list_configured_mcp_tools':return {'result':{'connections':[{'connectionId':'forum','tools':[{'name':'post'}]}]}}
            if body['name']=='call_configured_mcp_tool':
                external_calls.append(body)
                # The intent must be durable before the network operation even starts.
                self.assertEqual(len(store.status()['uncertainWrites']),1)
                raise TimeoutError('Uncertain external result')
            return {'result':{'longing':22}}
        with patch.object(runner,'Rpc',RPC),patch.object(runner,'http',side_effect=http),patch.object(runner,'context',return_value='Visible context'),patch.object(runner,'current_preferences',return_value={}),patch.object(runner,'front_busy',return_value=False),patch.object(runner.policy,'history',return_value=[{'id':'user','vesper_conversation_id':'chat'}]),patch.object(runner.policy,'normal',return_value=True):
            runner.execute(self.job)
            store.request('second',source='automation');runner.execute(dict(self.job,id='second'))
        self.assertEqual(len(external_calls),1)
        self.assertEqual(len(self.messages),2) # optional forum failure does not stop normal wake
        self.assertEqual(store.status()['uncertainWrites'][0]['tool'],'mcp:forum:post')
        self.assertNotIn('private test note',json.dumps(store.status()['uncertainWrites']))

if __name__=='__main__':unittest.main()
