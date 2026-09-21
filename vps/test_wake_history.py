import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import codex_history_server as server

class WakeHistoryTest(unittest.TestCase):
    def test_scoped_silent_records_and_auth(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(server, 'DB_PATH', Path(tmp)/'history.db'):
            with server.db() as db:
                for cid in ['one','other']:
                    db.execute("INSERT INTO conversations(vesper_conversation_id,title,created_at,updated_at) VALUES(?,?,?,?)",(cid,cid,'now','now'))
                    db.execute("INSERT INTO messages(id,vesper_conversation_id,role,content,status,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",(cid,cid,'system','activity','completed','{"wakeRunId":"run","wake":{"messageOmitted":true}}','now','now'))
            handler=object.__new__(server.Handler)
            handler.path='/conversations/one/wake-history'
            handler.command='GET'
            handler.authenticated=lambda:True
            results=[]
            handler.send_json=lambda status,data:results.append((status,data))
            handler.dispatch()
            self.assertEqual([m['id'] for m in results[0][1]['messages']],['one'])
            self.assertTrue(results[0][1]['messages'][0]['metadata']['wake']['messageOmitted'])
            handler.authenticated=lambda:False
            handler.dispatch()
            self.assertEqual(results[-1][0],401)
