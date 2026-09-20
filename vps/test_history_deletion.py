"""Exercise deletion through HTTP against an isolated, temporary history database."""
import importlib.util
import json
import sqlite3
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("history", Path(__file__).with_name("codex_history_server.py"))
history = importlib.util.module_from_spec(spec)
spec.loader.exec_module(history)


class DeletionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        history.DB_PATH = Path(self.directory.name) / "history.sqlite3"
        history.TOKEN_PATH = Path(self.directory.name) / "token"
        history.TOKEN_PATH.write_text("test-only")
        self.server = history.ThreadingHTTPServer(("127.0.0.1", 0), history.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.directory.cleanup()

    def request(self, method, path, body=None, token="test-only"):
        client = HTTPConnection(*self.server.server_address, timeout=5)
        client.request(method, path, json.dumps(body) if body is not None else None,
                       {"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        response = client.getresponse()
        result = response.status, json.loads(response.read())
        client.close()
        return result

    def seed(self, cid):
        self.assertEqual(self.request("POST", "/conversations/" + cid, {"title": cid})[0], 200)
        self.assertEqual(self.request("POST", "/conversations/" + cid + "/messages",
                                     {"id": cid + "-message", "role": "user", "content": "test"})[0], 200)

    def test_delete_children_repeated_delete_and_delayed_sync(self):
        self.seed("remove")
        self.seed("keep")
        self.request("DELETE", "/conversations/remove/messages/remove-message")
        self.request("POST", "/conversations/remove/messages",
                     {"id": "another", "role": "agent", "content": "test"})
        for _ in range(2):
            status, result = self.request("DELETE", "/conversations/remove")
            self.assertEqual(status, 200)
            self.assertTrue(result["permanent"])
        with history.db() as connection:
            for table in ("conversations", "messages", "message_tombstones"):
                count = connection.execute("SELECT COUNT(*) FROM " + table +
                    " WHERE vesper_conversation_id = 'remove'").fetchone()[0]
                self.assertEqual(count, 0)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM messages WHERE vesper_conversation_id = 'keep'").fetchone()[0], 1)
        self.assertEqual(self.request("POST", "/conversations/remove", {"title": "late"})[0], 410)
        self.assertEqual(self.request("POST", "/conversations/remove/messages",
            {"id": "late", "role": "user", "content": "late"})[0], 410)
        self.assertEqual(self.request("DELETE", "/conversations/remove/messages/late")[0], 200)
        self.assertEqual([c["id"] for c in self.request("GET", "/conversations")[1]["conversations"]], ["keep"])

    def test_storage_exception_has_http_response_and_rolls_back(self):
        self.seed("remove")
        with history.db() as connection:
            connection.execute("""CREATE TRIGGER fail_delete BEFORE DELETE ON conversations
                BEGIN SELECT RAISE(ABORT, 'test failure'); END""")
        status, _ = self.request("DELETE", "/conversations/remove")
        self.assertEqual(status, 503)
        with history.db() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM messages").fetchone()[0], 1)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM conversation_tombstones").fetchone()[0], 0)
        with patch.object(history, "db", side_effect=sqlite3.OperationalError("private detail")):
            status, response = self.request("GET", "/conversations")
            self.assertEqual(status, 503)
            self.assertNotIn("private detail", json.dumps(response))

    def test_authentication_still_required(self):
        self.seed("keep")
        self.assertEqual(self.request("DELETE", "/conversations/keep", token="wrong")[0], 401)
        self.assertEqual(len(self.request("GET", "/conversations")[1]["conversations"]), 1)


if __name__ == "__main__":
    unittest.main()

