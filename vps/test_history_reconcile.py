"""Mainline regression checks use only temporary databases and stub external cleanup."""
import json, sqlite3, tempfile, threading, unittest
from pathlib import Path
from http.client import HTTPConnection
from unittest.mock import patch
import codex_history_server as history

class ReconcileTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        history.DB_PATH = Path(self.temp.name) / 'history.sqlite'
        history.TOKEN_PATH = Path(self.temp.name) / 'token'
        history.TOKEN_PATH.write_text('fixture')
        for name, value in [('thread_is_shared', False), ('delete_codex_thread', 'fixture'), ('purge_wake', 0)]:
            mock = patch.object(history.conversation_delete, name, return_value=value)
            mock.start(); self.addCleanup(mock.stop)
        self.server = history.ThreadingHTTPServer(('127.0.0.1', 0), history.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()
    def request(self, method, path, body=None, token='fixture'):
        client = HTTPConnection(*self.server.server_address, timeout=5)
        client.request(method, path, json.dumps(body) if body else None, {'Authorization': 'Bearer '+token})
        response = client.getresponse(); result = response.status, json.loads(response.read()); client.close(); return result
    def seed(self):
        self.assertEqual(self.request('POST','/conversations/a',{'title':'fixture'})[0],200)
        with history.db() as db:
            for i in range(1205):
                db.execute('INSERT INTO messages(id,vesper_conversation_id,role,content,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', (f'm{i:04}','a','user','哎 100%_ Hello' if i==1001 else 'ordinary','completed','2026-09-21T00:00:00Z','now'))
    def test_search_around_and_scoped_cursor(self):
        self.seed()
        self.assertEqual(self.request('GET','/search?q=Hello',token='bad')[0],401)
        self.assertEqual(self.request('GET','/search?q=100%25_')[1]['results'][0]['id'],'m1001')
        status, page = self.request('GET','/conversations/a?around=m1001&limit=20')
        self.assertEqual(status,200); self.assertEqual(len(page['messages']),20)
        self.assertIn('m1001',[m['id'] for m in page['messages']]); self.assertTrue(page['hasMore'])
        self.assertEqual(self.request('GET','/conversations/a?latest=1&before=missing')[0],400)
        self.assertEqual(self.request('GET','/conversations/a?around=missing')[0],404)
    def test_cleanup_rollback_and_tombstone(self):
        self.seed()
        with history.db() as db:
            db.execute("CREATE TRIGGER fail_delete BEFORE DELETE ON conversations BEGIN SELECT RAISE(ABORT,'fixture'); END")
        self.assertEqual(self.request('DELETE','/conversations/a')[0],503)
        with history.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM messages').fetchone()[0],1205)
            self.assertTrue(history.conversation_delete.is_deleted(db,'a'))
            db.execute('DROP TRIGGER fail_delete')
        self.assertEqual(self.request('DELETE','/conversations/a')[0],200)
        self.assertEqual(self.request('DELETE','/conversations/a')[0],200)
        self.assertEqual(self.request('DELETE','/conversations/a/messages/m1001')[0],200)
        self.assertEqual(self.request('POST','/conversations/a',{'title':'late'})[0],410)
        self.assertEqual(self.request('POST','/conversations/a/messages',{'id':'late','role':'user','content':'late'})[0],410)
    def test_storage_error_response(self):
        with patch.object(history,'db',side_effect=sqlite3.OperationalError('private detail')):
            status, body = self.request('GET','/conversations')
            self.assertEqual(status,503); self.assertNotIn('private detail',str(body))

if __name__ == '__main__': unittest.main()
