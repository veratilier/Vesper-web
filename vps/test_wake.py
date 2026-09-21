import tempfile, unittest, sqlite3, json, time
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
import vesper_wake_store as store
import vesper_wake_runner as runner
import vesper_wake_policy as policy

class WakeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.addCleanup(patch.stopall)
        patch.object(runner,'current_preferences',lambda:{}).start()
        self.old=store.PATH;store.PATH=Path(self.temp.name)/'wake.db';self.addCleanup(lambda:setattr(store,'PATH',self.old))
    def test_real_curl_preserves_utf8_and_json_escapes(self):
        from http.server import BaseHTTPRequestHandler, HTTPServer
        import threading
        received=[]
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_POST(self):
                received.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
                self.send_response(200);self.end_headers();self.wfile.write(b'{"ok":true}')
        server=HTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        token=Path(self.temp.name)/'test-token';token.write_text('fixture-only')
        payload={'message':'你好，Vera 🌙\n第二行："引号"；路径 C:\\notes；字面量 \\u6211','nested':{'text':'温柔'}}
        try:
            with patch.object(runner,'TOKEN',token),patch.object(runner,'ORIGIN',f'http://127.0.0.1:{server.server_port}'):
                self.assertEqual(runner.http('/test',payload),{'ok':True})
            self.assertEqual(received,[payload])
        finally:server.shutdown();server.server_close();thread.join()
    def test_request_is_idempotent_and_joins_pending(self):
        self.assertEqual(store.request('one'),store.request('one'))
        self.assertEqual(store.request('one'),store.request('two'))
        with store.db() as con:self.assertEqual(con.execute('SELECT count(*) FROM jobs').fetchone()[0],1)
    def test_presence_expires(self):
        store.presence('phone',True)
        with patch.object(runner,'HISTORY',Path(self.temp.name)/'absent'):
            self.assertTrue(runner.front_busy(time.time()))
            self.assertFalse(runner.front_busy(time.time()+91))
    def test_full_runner_saves_before_push_and_deduplicates_tools(self, share=True):
        ident=store.request('verify',source='verification');messages={};calls=[];push=[]
        runner.update(ident,conversation_id='chat-existing',user_message_id='real-user',user_turn_id='normal-turn')
        with store.db() as con:job=dict(con.execute('SELECT * FROM jobs').fetchone())
        class Rpc:
            def __init__(self):self.handler=None;self.queue=[]
            def send(self,m):pass
            def close(self):pass
            def call(self,name,args):
                if name=='account/read':return {'account':{'type':'chatgpt'}}
                if name=='thread/start':
                    assert args['approvalPolicy']=='never'
                    assert all(t['name'] in runner.READ_ONLY for t in args['dynamicTools'])
                    return {'thread':{'id':'thread'}}
                if name=='turn/start':
                    for n,tool in enumerate(['desire_status','read_vesper_state']):
                        message={'id':100+n,'method':'item/tool/call','params':{'name':tool,'itemId':str(n),'arguments':{}}}
                        self.queue.extend([message,message])
                    self.queue.extend([{'method':'item/completed','params':{'item':{'id':'answer','type':'agentMessage','text':json.dumps({'share':share,'message':'A real saved reply' if share else ''})}}},
                        {'method':'turn/completed','params':{'turn':{'status':'completed'}}}])
                    return {'turn':{'id':'turn'}}
                return {}
            def next(self,timeout):return self.queue.pop(0)
        def http(path,body=None,history=False):
            if path=='/api/codex/tools' and body is None:return {'tools':[{'name':n} for n in runner.ALLOWED]}
            if path=='/api/codex/tools':
                assert body['conversationId']=='chat-existing'
                calls.append(body);return {'result':{'style':'quiet'}}
            if path.endswith('/messages'):messages[body['id']]=body;return {}
            if path=='/api/wake':
                assert any(m['role']=='agent' for m in messages.values())
                with store.db() as con:assert con.execute('SELECT status FROM jobs').fetchone()[0]=='saved'
                push.append(body);return {'status':'sent','delivered':1}
            return {}
        class Night(datetime):
            @classmethod
            def now(cls,tz=None):return datetime(2026,9,10,2,tzinfo=tz)
        with patch.object(runner,'datetime',Night),patch.object(runner,'Rpc',Rpc),patch.object(runner,'http',http),patch.object(runner,'context',lambda job:''),patch.object(runner,'front_busy',lambda n:False),patch.object(policy,'history',lambda p:[{'id':'real-user','vesper_conversation_id':'chat-existing','metadata_json':'{}','content':'Hello'}]):
            runner.execute(job)
        self.assertEqual(len(calls),2)
        if not share:
            self.assertEqual(push,[])
            self.assertFalse(any(m['role']=='agent' for m in messages.values()))
            self.assertEqual(messages,{})
            ledger=store.status()['lastJob']['calls']
            self.assertEqual(len(ledger),2)
            self.assertTrue(all(c['started'] and c['finished'] for c in ledger))
            self.assertEqual(store.status()['lastJob']['status'],'silent');return
        self.assertEqual(len(push),1)
        self.assertEqual(store.status()['lastJob']['status'],'completed')
        self.assertEqual(sum(m['role']=='agent' for m in messages.values()),1)
        self.assertEqual(len(messages),1)
    def test_silent_round_records_tools_without_message_or_push(self):
        self.test_full_runner_saves_before_push_and_deduplicates_tools(False)
    def test_off_does_not_auto_start_and_partial_turn_is_not_replayed(self):
        store.request('interrupted')
        runner.update('interrupted',status='running')
        with patch.object(runner,'http',lambda *a,**kw:{'value':{'careFrequency':'off'}}),patch.object(runner,'front_busy',lambda n:False),patch.object(runner,'reschedule'),patch.object(runner,'execute') as execute:
            runner.tick()
            execute.assert_not_called()
        self.assertEqual(store.status()['lastJob']['status'],'interrupted')
    def test_busy_defers_manual_job(self):
        store.request('wait')
        with patch.object(runner,'http',lambda *a,**kw:{'value':{'careFrequency':'daily'}}),patch.object(runner,'front_busy',lambda n:True),patch.object(runner,'reschedule'),patch.object(runner,'execute') as execute:
            runner.tick();execute.assert_not_called()
        self.assertEqual(store.status()['lastJob']['status'],'queued')
    def test_no_api_key_fallback(self):
        # Execution refuses an API-key account before starting any model turn.
        ident=store.request('no-api')
        runner.update(ident,conversation_id='chat-existing',user_message_id='real-user',user_turn_id='normal-turn')
        with store.db() as con:job=dict(con.execute('SELECT * FROM jobs').fetchone())
        class Rpc:
            def call(self,m,p):return {'account':{'type':'apiKey'}} if m=='account/read' else {}
            def send(self,m):pass
            def close(self):pass
        def http(path,body=None,history=False):return {'tools':[{'name':'desire_status'},{'name':'read_vesper_state'}]}
        class Night(datetime):
            @classmethod
            def now(cls,tz=None):return datetime(2026,9,10,2,tzinfo=tz)
        with patch.object(runner,'datetime',Night),patch.object(runner,'Rpc',Rpc),patch.object(runner,'http',http):
            with self.assertRaisesRegex(RuntimeError,'API-key fallback disabled'):runner.execute(job)

if __name__=='__main__':unittest.main()
