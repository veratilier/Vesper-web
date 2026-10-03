import json
import sqlite3
import unittest
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
        rendered = screenshot.document(data)
        self.assertIn('class="row own"><small>Rowan',rendered)
        self.assertIn('class="row other"><small>Vera',rendered)
        self.assertIn('&lt;script&gt;',rendered)
        self.assertNotIn('<script>',rendered)

    def test_wrong_missing_duplicate_reordered_private_ids(self):
        for ids in (['other'],['missing'],['u','u'],['a','u'],['hidden'],[]):
            with self.subTest(ids=ids),self.assertRaises(ValueError):
                screenshot.select_messages(self.db,'one',ids)

    def test_archived_and_deleted_conversation(self):
        self.db.execute('UPDATE conversations SET archived_at="now" WHERE vesper_conversation_id="one"')
        with self.assertRaises(ValueError): screenshot.select_messages(self.db,'one',['u'])
        with self.assertRaises(ValueError): screenshot.select_messages(self.db,'missing',['u'])

    def test_no_silent_truncation(self):
        self.db.execute('UPDATE messages SET content=? WHERE id="u"',('字'*16001,))
        with self.assertRaises(ValueError): screenshot.select_messages(self.db,'one',['u'])

    def test_image_url_is_reconstructed_from_media_key(self):
        data=screenshot.select_messages(self.db,'one',['u'])
        data['messages'][0]['attachments']=[{'key':'abc-123.jpg','type':'image/jpeg','url':'http://127.0.0.1/private'}]
        self.assertIn('https://api.vesper.r-vera.com/api/media/abc-123.jpg',screenshot.document(data))
        self.assertNotIn('127.0.0.1',screenshot.document(data))


if __name__ == '__main__': unittest.main()
