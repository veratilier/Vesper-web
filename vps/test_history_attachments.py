"""Attachment-only native messages must survive persistence before turn/start."""
import tempfile
import unittest
from pathlib import Path
import codex_history_server as server


class Request:
    path = '/conversations/test'

    def __init__(self, body=None):
        self.payload = body

    def body(self):
        return self.payload

    def send_json(self, status, value):
        self.status, self.value = status, value


class AttachmentHistoryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.original_db = server.DB_PATH
        server.DB_PATH = Path(self.directory.name) / 'history.sqlite3'

    def tearDown(self):
        server.DB_PATH = self.original_db
        self.directory.cleanup()

    def save(self, attachments, content='', message_id='photo'):
        request = Request({'id': message_id, 'role': 'user', 'content': content,
                           'metadata': {'attachments': attachments}})
        server.Handler.upsert_message(request, 'test')
        return request

    def test_photo_file_and_multiple_images_round_trip_without_caption(self):
        for attachments in [
            [{'url': 'https://example.com/a.jpg', 'type': 'image/jpeg', 'key': 'a.jpg'}],
            [{'url': 'https://example.com/a.pdf', 'type': 'application/pdf'}],
            [{'url': 'https://example.com/a.jpg', 'type': 'image/jpeg'},
             {'url': 'https://example.com/b.jpg', 'type': 'image/jpeg'}],
        ]:
            with self.subTest(attachments=attachments):
                saved = self.save(attachments)
                self.assertEqual(saved.status, 200)
                request = Request()
                server.Handler.get_conversation(request, 'test')
                self.assertEqual(request.status, 200)
                self.assertEqual(len(request.value['messages']), 1)
                message = request.value['messages'][0]
                self.assertEqual(message['content'], '')
                self.assertEqual(message['metadata']['attachments'], attachments)

    def test_empty_and_malformed_attachments_remain_invalid(self):
        for attachments in [None, [], {}, 'photo', [None], [{}],
                            [{'url': 'file:///tmp/photo', 'type': 'image/jpeg'}],
                            [{'url': 'https://[', 'type': 'image/jpeg'}],
                            [{'url': 'https://example.com/a'}],
                            [{'url': '', 'type': 'image/jpeg'}]]:
            with self.subTest(attachments=attachments):
                self.assertEqual(self.save(attachments).status, 400)

    def test_text_and_caption_remain_valid(self):
        self.assertEqual(self.save([], 'normal message').status, 200)
        self.assertEqual(self.save([{'url': 'https://example.com/a.jpg', 'type': 'image/jpeg'}], 'caption').status, 200)

    def test_attachment_does_not_bypass_message_checks(self):
        attachment = [{'url': 'https://example.com/a.jpg', 'type': 'image/jpeg'}]
        self.assertEqual(self.save(attachment, message_id='').status, 400)
        self.assertEqual(self.save(attachment, content='x' * 120001).status, 400)

    def test_deleted_conversation_cannot_be_recreated_by_attachment(self):
        with server.db() as db:
            server.conversation_delete.block(db, 'test', None)
        self.assertEqual(self.save([{'url': 'https://example.com/a.jpg', 'type': 'image/jpeg'}]).status, 410)

    def batch(self, children, **fields):
        request = Request(dict({'id': 'batch', 'role': 'user', 'content': '',
                                'metadata': {'attachments': [], 'batchMessages': children}}, **fields))
        server.Handler.upsert_message(request, 'test')
        return request

    def child(self, **metadata):
        # This is the native ChatQueuedMessage wire format: sticker is in metadata,
        # without a top-level type or caption on the enclosing batch.
        return {'id': 'child', 'role': 'user', 'conversationId': 'test', 'content': '',
                'metadata': dict({'attachments': []}, **metadata)}

    def test_collected_sticker_round_trip_and_following_upload(self):
        children = [self.child(sticker={'assetId': 'asset', 'url': 'https://example.com/s.png', 'mimeType': 'image/png'})]
        self.assertEqual(self.batch(children).status, 200)
        self.assertEqual(self.save([], 'following message', 'next').status, 200)
        with server.db() as db:
            saved = server.message(db.execute("SELECT * FROM messages WHERE id='batch'").fetchone())
            self.assertEqual(db.execute('SELECT COUNT(*) FROM messages').fetchone()[0], 2)
        self.assertEqual(saved['content'], '')
        self.assertEqual(saved['metadata']['batchMessages'], children)

    def test_collected_media_and_text_payloads(self):
        for child in [self.child(attachments=[{'url': 'https://example.com/p.jpg', 'type': 'image/jpeg'}]),
                      self.child(musicCard={'title': 'Song'}),
                      self.child(locationCard={'latitude': 31.2, 'longitude': 121.5}),
                      dict(self.child(), content='hello')]:
            with self.subTest(child=child):
                self.assertEqual(self.batch([child]).status, 200)

    def test_invalid_batch_cannot_bypass_empty_message_validation(self):
        sticker = self.child(sticker={'assetId': 'a', 'url': 'https://example.com/s', 'mimeType': 'image/png'})
        for children in [None, [], {}, [None], [self.child()], [dict(sticker, role='agent')],
                         [dict(sticker, id='')], [dict(sticker, conversationId='another')],
                         [dict(sticker, content='x' * 120001)], [sticker, sticker],
                         [self.child(sticker={})], [self.child(musicCard={})],
                         [self.child(attachments=[{'url': 'file:///photo', 'type': 'image/jpeg'}])],
                         [self.child(batchMessages=[sticker])],
                         [dict(sticker, content='[vesper response preference — not user content: private]')]]:
            with self.subTest(children=children):
                self.assertEqual(self.batch(children).status, 400)
        self.assertEqual(self.batch([sticker], role='agent').status, 400)
        self.assertEqual(self.batch([sticker], id='').status, 400)

    def test_collected_sticker_honors_conversation_and_message_deletion(self):
        children = [self.child(sticker={'assetId': 'asset', 'url': 'https://example.com/s.png', 'mimeType': 'image/png'})]
        self.assertEqual(self.batch(children).status, 200)
        with server.db() as db:
            db.execute("INSERT INTO message_tombstones VALUES ('test', '', 'batch', ?)", (server.now(),))
        deleted = self.batch(children)
        self.assertEqual(deleted.status, 200)
        self.assertTrue(deleted.value['deleted'])
        with server.db() as db:
            server.conversation_delete.block(db, 'test', None)
        self.assertEqual(self.batch(children).status, 410)


if __name__ == '__main__':
    unittest.main()
