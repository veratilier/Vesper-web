import json
import sqlite3
import unittest
from io import BytesIO
from PIL import Image
from unittest.mock import patch
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
        self.assertEqual(data['title'], 'Our chat')
        self.assertEqual(data['conversationId'], 'one')
        self.assertEqual(data['messages'][1]['role'], 'agent')
        with patch.object(screenshot, '_capture_appearance', return_value={'palette': 'blue', 'shade': 0.28, 'backgroundUrl': ''}):
            result = screenshot.render(data, 'not-used')
        picture = Image.open(BytesIO(__import__('base64').b64decode(result['base64'])))
        self.assertEqual(picture.size[0], screenshot.PHONE_WIDTH)
        self.assertEqual(result['messageIds'], ['u', 'a'])
        self.assertEqual(result['mimeType'], 'image/jpeg')

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

    def test_explicit_bubbles_are_original_and_separate(self):
        self.db.execute('UPDATE messages SET content=?,metadata_json=? WHERE id="a"', (
            '第一句。\n\n第二句。', json.dumps({'bubbles': [{'text': '第一句。'}, {'text': '第二句。'}]})))
        data = screenshot.select_messages(self.db, 'one', ['a'])
        self.assertEqual(data['messages'][0]['textBubbles'], ['第一句。', '第二句。'])
        self.db.execute('UPDATE messages SET metadata_json=? WHERE id="a"', (
            json.dumps({'bubbles': [{'text': '替换原文'}]}),))
        data = screenshot.select_messages(self.db, 'one', ['a'])
        self.assertEqual(data['messages'][0]['textBubbles'], [])

    def test_photo_origin_is_fixed(self):
        for url in ('http://127.0.0.1/private', 'https://evil.test/api/media/a.jpg',
                    'https://api.vesper.r-vera.com/api/state',
                    'https://api.vesper.r-vera.com/api/media/a.jpg?redirect=1'):
            with self.subTest(url=url), self.assertRaises(screenshot.ScreenshotUnavailable):
                screenshot._photo_bytes({'url': url})


if __name__ == '__main__': unittest.main()
