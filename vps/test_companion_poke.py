import json
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch
import codex_history_server as history
import vesper_companion_poke as poke
from test_history_reconcile import ReconcileTests

class PokeTests(unittest.TestCase):
    setUp = ReconcileTests.setUp
    tearDown = ReconcileTests.tearDown
    request = ReconcileTests.request
    # Only the new endpoint contracts; no inherited broad regression rerun.
    def seed_poke(self):
        self.request('POST', '/conversations/a', {'title': 'Poke fixture'})
        return {'requestId': str(uuid.uuid4()), 'conversationId': 'a', 'instructions': 'Fixture prompt'}

    def test_poke_auth_dedup_and_background_reply(self):
        body = self.seed_poke()
        self.assertEqual(self.request('POST', '/companion/poke', body, token='bad')[0], 401)
        self.assertEqual(self.request('POST', '/companion/poke', body)[0], 202)
        self.assertEqual(self.request('POST', '/companion/poke', body)[0], 200)
        again = dict(body, requestId=str(uuid.uuid4()))
        self.assertEqual(self.request('POST', '/companion/poke', again)[1]['requestId'], body['requestId'])
        calls = []
        poke.drain(history.db, lambda payload, context: calls.append(payload) or 'Fixture response')
        poke.drain(history.db, lambda *_: self.fail('Completed job was replayed'))
        self.assertEqual(len(calls), 1)
        with history.db() as con:
            rows = con.execute('SELECT role,content FROM messages ORDER BY created_at').fetchall()
            self.assertEqual([r['role'] for r in rows], ['user','agent'])
            self.assertEqual(rows[-1]['content'], 'Fixture response')
            job = con.execute('SELECT * FROM companion_pokes').fetchone()
            self.assertEqual(job['status'], 'completed')
            self.assertEqual(job['payload'], '{}')

    def test_deleted_target_is_never_restored(self):
        body = self.seed_poke()
        self.assertEqual(self.request('POST', '/companion/poke', body)[0], 202)
        with history.db() as con:
            con.execute("UPDATE conversations SET archived_at='deleted' WHERE vesper_conversation_id='a'")
        poke.drain(history.db, lambda *_: self.fail('Deleted target invoked model'))
        self.assertEqual(self.request('POST', '/companion/poke', body)[0], 410)
        with history.db() as con:
            self.assertEqual(con.execute('SELECT status FROM companion_pokes').fetchone()[0], 'cancelled')
            self.assertEqual(con.execute("SELECT count(*) FROM messages WHERE role='agent'").fetchone()[0], 0)

    def test_failure_never_fabricates_or_replays_reply(self):
        body = self.seed_poke()
        self.request('POST', '/companion/poke', body)
        def fail(*_): raise RuntimeError('fixture failure')
        poke.drain(history.db, fail)
        poke.drain(history.db, lambda *_: self.fail('Failed model was replayed'))
        with history.db() as con:
            self.assertEqual(con.execute('SELECT status FROM companion_pokes').fetchone()[0], 'failed')
            self.assertEqual(con.execute("SELECT count(*) FROM messages WHERE role='agent'").fetchone()[0], 0)
            self.assertEqual(con.execute("SELECT count(*) FROM messages WHERE role='system'").fetchone()[0], 1)

    def test_delete_while_model_is_running_drops_reply(self):
        body = self.seed_poke(); self.request('POST', '/companion/poke', body)
        def reply(*_):
            with history.db() as con:
                con.execute("UPDATE conversations SET archived_at='deleted' WHERE vesper_conversation_id='a'")
            return 'Must not be saved'
        poke.drain(history.db, reply)
        with history.db() as con:
            self.assertEqual(con.execute("SELECT count(*) FROM messages WHERE role='agent'").fetchone()[0], 0)

if __name__ == '__main__':
    unittest.main()
