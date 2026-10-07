import json
import sqlite3
import unittest
from io import BytesIO
from unittest.mock import patch, Mock
import vesper_chat_screenshot as screenshot


class OriginalScreenshotTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.db.executescript('CREATE TABLE conversations(vesper_conversation_id TEXT,title TEXT,archived_at TEXT); CREATE TABLE messages(id TEXT,vesper_conversation_id TEXT,role TEXT,content TEXT,created_at TEXT,metadata_json TEXT); INSERT INTO conversations VALUES("one","Our chat",NULL),("two","Other",NULL);')
        self.db.executemany('INSERT INTO messages VALUES(?,?,?,?,?,?)', [
            ('u','one','user','你好 <script>steal()</script>','2026-10-03T00:00:00Z','{}'),
            ('a','one','agent','I kept this.','2026-10-03T00:01:00Z','{}'),
            ('hidden','one','agent','private tool output','2026-10-03T00:02:00Z',json.dumps({'blockType':'reasoning'})),
            ('other','two','user','Other chat','2026-10-03T00:03:00Z','{}')])

    def tearDown(self):
        self.db.close()

    def test_original_order_and_perspective(self):
        data = screenshot.select_messages(self.db,'one',['u','a'])
        self.assertEqual(data['messages'][0]['content'],'你好 <script>steal()</script>')
        self.assertEqual(data['conversationId'], 'one')
        self.assertEqual(data['messages'][1]['role'], 'agent')
        self.assertIn('capture=agent', screenshot.capture_url(data))

    def test_wrong_missing_duplicate_reordered_private_ids(self):
        for ids in (['other'],['missing'],['u','u'],['a','u'],['hidden'],[]):
            with self.subTest(ids=ids),self.assertRaises(ValueError):
                screenshot.select_messages(self.db,'one',ids)

    def test_capture_uses_only_authorized_original_snapshot(self):
        data = screenshot.select_messages(self.db, 'one', ['u', 'a'])
        self.db.execute('UPDATE messages SET content="later edit" WHERE id="u"')
        history = screenshot.capture_history(data)
        self.assertEqual([m['id'] for m in history['messages']], ['u', 'a'])
        self.assertEqual(history['messages'][0]['content'], '你好 <script>steal()</script>')
        self.assertFalse(history['hasMore'])
        self.assertEqual(history['messages'][0]['metadata'], {'attachments': []})

    def test_capture_state_exposes_only_appearance_and_profile(self):
        opener = Mock()
        opener.open.return_value = BytesIO(json.dumps({'documents': {
            'profile': {'value': {'userName': 'Vera'}},
            'appearance': {'value': {'accent': '#fff'}},
            'private-notes': {'value': 'not needed by capture'},
        }}).encode())
        with patch.object(screenshot, 'build_opener', return_value=opener) as factory:
            state = screenshot.capture_appearance('fixture-token')
        self.assertEqual(set(state['documents']), {'profile', 'appearance'})
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, screenshot.API_ORIGIN + '/api/state')
        self.assertEqual(request.get_header('X-vesper-device-token'), 'fixture-token')
        self.assertIsNone(factory.call_args.args[0].redirect_request(None, None, 302, '', {}, 'https://other.test'))

    def test_archived_and_deleted_conversation(self):
        self.db.execute('UPDATE conversations SET archived_at="now" WHERE vesper_conversation_id="one"')
        with self.assertRaises(ValueError): screenshot.select_messages(self.db,'one',['u'])
        with self.assertRaises(ValueError): screenshot.select_messages(self.db,'missing',['u'])

    def test_no_silent_truncation(self):
        self.db.execute('UPDATE messages SET content=? WHERE id="u"',('字'*16001,))
        with self.assertRaises(ValueError): screenshot.select_messages(self.db,'one',['u'])

    def test_browser_request_policy_and_credentials_scope(self):
        data=screenshot.select_messages(self.db,'one',['u','a'])
        exact='https://codex.r-vera.com/history/conversations/one?captureMessageId=u&captureMessageId=a'
        self.assertEqual(screenshot.request_policy(exact,'GET',data),'history')
        self.assertEqual(screenshot.request_policy('https://api.vesper.r-vera.com/api/state','GET',data),'app')
        self.assertEqual(screenshot.request_policy('https://vesper.r-vera.com/backgrounds/vesper-marble-20260908.jpg','GET',data),'asset')
        for url,method in [(exact,'POST'),(exact.replace('one','two'),'GET'),(exact.replace('&captureMessageId=a',''),'GET'),('http://127.0.0.1/private','GET'),('https://evil.test/photo.jpg','GET'),('https://api.vesper.r-vera.com/api/codex/tools','GET'),('https://vesper.r-vera.com/api/state','PUT')]:
            with self.subTest(url=url,method=method): self.assertIsNone(screenshot.request_policy(url,method,data))


if __name__ == '__main__': unittest.main()
