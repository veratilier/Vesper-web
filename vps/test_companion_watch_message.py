"""A typed watch message must never carry the legacy pat classification flag."""
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import vesper_companion_poke as companion


class WatchMessageIdentityTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / 'history.sqlite3'
        with self.connect() as con:
            con.executescript('''
                CREATE TABLE conversations (vesper_conversation_id TEXT PRIMARY KEY, updated_at TEXT);
                CREATE TABLE message_tombstones (vesper_conversation_id TEXT, stable_id TEXT);
                CREATE TABLE messages (id TEXT PRIMARY KEY, vesper_conversation_id TEXT, role TEXT,
                    content TEXT, status TEXT, metadata_json TEXT, created_at TEXT, updated_at TEXT,
                    source TEXT, time_source TEXT, message_type TEXT);
                INSERT INTO conversations VALUES ('room', '');
            ''')

    def tearDown(self):
        self.directory.cleanup()

    def connect(self):
        con = sqlite3.connect(self.path)
        con.row_factory = sqlite3.Row
        return con

    def test_watch_text_keeps_its_body_and_has_no_poke_marker(self):
        with self.connect() as con, patch.object(companion, 'active', return_value=True):
            companion.write_message(con, {'id': 'watch-1', 'conversation_id': 'room'},
                                    'tap', 'user', '手表发来的正文',
                                    {'source': 'watch', 'watchMessage': True})
            row = con.execute("SELECT * FROM messages WHERE id='poke:watch-1:tap'").fetchone()
        self.assertEqual(row['content'], '手表发来的正文')
        self.assertEqual(json.loads(row['metadata_json'])['watchMessageId'], 'watch-1')
        self.assertNotIn('companionPokeId', json.loads(row['metadata_json']))

    def test_actual_watch_poke_keeps_poke_marker(self):
        with self.connect() as con, patch.object(companion, 'active', return_value=True):
            companion.write_message(con, {'id': 'poke-1', 'conversation_id': 'room'},
                                    'tap', 'user', '（我在手表上轻轻拍了拍你。）', {'source': 'watch'})
            row = con.execute("SELECT * FROM messages WHERE id='poke:poke-1:tap'").fetchone()
        self.assertEqual(json.loads(row['metadata_json'])['companionPokeId'], 'poke-1')
        self.assertNotIn('watchMessage', json.loads(row['metadata_json']))


if __name__ == '__main__':
    unittest.main()
