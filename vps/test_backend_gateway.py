import io,json,sqlite3,tempfile,threading,unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch,Mock
from urllib.request import Request,urlopen
from urllib.error import HTTPError
import codex_history_server as history
from vesper_backend import storage

class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.token=self.root/'token';self.token.write_text('fixture-secret')
        self.patches=[patch.object(history,'DB_PATH',self.root/'history.sqlite3'),patch.object(history,'TOKEN_PATH',self.token)]
        for p in self.patches:p.start()
        self.server=history.ThreadingHTTPServer(('127.0.0.1',0),history.Handler)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.origin=f'http://127.0.0.1:{self.server.server_port}'
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join()
        for p in self.patches:p.stop()
        self.temp.cleanup()
    def request(self,path,method='GET',body=None,authorized=True):
        headers={'Content-Type':'application/json'}
        if authorized:headers['Authorization']='Bearer fixture-secret'
        try:
            with urlopen(Request(self.origin+path,method=method,headers=headers,data=json.dumps(body).encode() if body is not None else None)) as response:
                return response.status,json.load(response),response.headers
        except HTTPError as error:return error.code,json.load(error),error.headers
    def test_authentication_precedes_domain_dispatch_and_request_logs_omit_private_values(self):
        log=io.StringIO()
        with patch.object(history.screen_companion,'dispatch') as model,redirect_stdout(log):
            code,value,headers=self.request('/companion/watch?private=should-not-log',method='POST',body={'image':'private-frame'},authorized=False)
        self.assertEqual(code,401);model.assert_not_called();self.assertIsNotNone(headers.get('X-Vesper-Request-ID'))
        self.assertNotIn('fixture-secret',log.getvalue());self.assertNotIn('private-frame',log.getvalue());self.assertNotIn('should-not-log',log.getvalue())
    def test_success_is_not_sent_before_sqlite_commit(self):
        original=history.db
        class RejectCommit:
            def __enter__(self):self.connection=original();return self.connection
            def __exit__(self,*args):
                self.connection.rollback();self.connection.close();raise sqlite3.OperationalError('secret commit failure')
        with patch.object(history,'db',side_effect=lambda:RejectCommit()):
            code,value,headers=self.request('/conversations/room/messages',method='POST',body={'id':'message','role':'user','content':'fixture'})
        self.assertEqual(code,503);self.assertNotIn('message',value);self.assertNotIn('secret',json.dumps(value))
        with original() as con:self.assertEqual(con.execute('SELECT count(*) FROM messages').fetchone()[0],0)
    def test_unknown_service_failure_is_bounded_and_does_not_expose_exception_contents(self):
        with patch.object(history.screen_companion,'dispatch',side_effect=RuntimeError('private token and prompt')):
            code,value,_=self.request('/companion/watch',method='POST',body={})
        self.assertEqual(code,500);self.assertNotIn('private',json.dumps(value))
    def test_deleted_message_stays_deleted_across_modular_routes(self):
        payload={'id':'message','role':'user','content':'fixture'}
        self.assertEqual(self.request('/conversations/room/messages','POST',payload)[0],200)
        self.assertEqual(self.request('/conversations/room/messages/message','DELETE',{})[0],200)
        self.assertTrue(self.request('/conversations/room/messages','POST',payload)[1]['deleted'])
        self.assertEqual(self.request('/conversations/room?latest=1')[1]['messages'],[])

class StorageInitializationTests(unittest.TestCase):
    def test_schema_runs_once_per_database_and_retries_failed_initialization(self):
        original=sqlite3.connect;attempts=[];fail=[True]
        class Traced(sqlite3.Connection):
            def executescript(self,sql):
                attempts.append(sql)
                if fail[0]:fail[0]=False;raise sqlite3.OperationalError('temporary storage failure')
                return super().executescript(sql)
        def connect(*args,**kwargs):return original(*args,**kwargs,factory=Traced)
        with tempfile.TemporaryDirectory() as tmp,patch.object(storage.sqlite3,'connect',side_effect=connect):
            path=Path(tmp)/'history.db'
            with self.assertRaises(sqlite3.Error):storage.open_history(path)
            storage.open_history(path).close();storage.open_history(path).close()
            self.assertEqual(len(attempts),2)
            path.unlink();storage.open_history(path).close()
            self.assertEqual(len(attempts),3)

if __name__=='__main__':unittest.main()
