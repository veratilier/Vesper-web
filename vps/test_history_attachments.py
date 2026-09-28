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


if __name__ == '__main__':
    unittest.main()
