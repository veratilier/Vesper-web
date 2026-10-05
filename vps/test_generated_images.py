import base64
import tempfile
import unittest
from pathlib import Path
import codex_history_server as server
import vesper_generated_images as images

THREAD = '01a0bfd9-a09d-7303-83cf-6ab9e2b5f6eb'
OTHER = '01a0bfd9-a09d-7303-83cf-6ab9e2b5f6eb'.replace('bfd9', 'bfea')

class GeneratedImagesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.previous = server.DB_PATH, images.deletion.CODEX_HOME
        server.DB_PATH = Path(self.temp.name).resolve() / 'history.db'
        images.deletion.CODEX_HOME = Path(self.temp.name).resolve() / '.codex'
        self.root = images.deletion.CODEX_HOME / 'generated_images' / THREAD
        self.root.mkdir(parents=True)
        self.image = self.root / 'generated.png'
        self.data = b'\x89PNG\r\n\x1a\n' + b'x' * (2 * 1024 * 1024)
        self.image.write_bytes(self.data)
        self.con = server.db()
        self.con.execute("INSERT INTO conversations(vesper_conversation_id,codex_thread_id,created_at,updated_at) VALUES('chat',?,'now','now')", (THREAD,))
        self.con.commit()

    def tearDown(self):
        self.con.close()
        server.DB_PATH, images.deletion.CODEX_HOME = self.previous
        self.temp.cleanup()

    def send(self, path=None, thread=THREAD):
        return images.export_image(self.con, 'chat', thread, str(path or self.image))

    def test_large_image_transfers_complete_real_bytes_and_replay_digest(self):
        result = self.send()
        self.assertEqual(base64.b64decode(result['base64']), self.data)
        self.assertEqual(result['size'], len(self.data))
        self.assertEqual(result['mimeType'], 'image/png')
        self.assertEqual(self.send('generated.png'), result)

    def test_other_thread_private_paths_and_traversal_blocked(self):
        for path, thread in [(self.image, OTHER), (images.deletion.CODEX_HOME / 'app-server-token', THREAD),
                             (self.root / '..' / THREAD / 'generated.png', THREAD)]:
            with self.subTest(path=path), self.assertRaises(ValueError): self.send(path, thread)

    def test_symlinks_blocked_even_within_image_folder(self):
        link = self.root / 'link.png'
        link.symlink_to(self.image)
        with self.assertRaises(ValueError): self.send(link)
        folder = self.root / 'folder'
        folder.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError): self.send(folder / 'generated.png')

    def test_archive_and_deleted_chat_blocked(self):
        self.con.execute("UPDATE conversations SET archived_at='now'")
        with self.assertRaises(ValueError): self.send()
        self.con.execute('UPDATE conversations SET archived_at=NULL')
        images.deletion.block(self.con, 'chat', THREAD)
        with self.assertRaises(ValueError): self.send()

    def test_missing_non_image_directory_and_oversize_blocked(self):
        for data in [b'private text', b'', b'\x89PNG\r\n\x1a\n' + b'x' * images.MAX_BYTES]:
            self.image.write_bytes(data)
            with self.assertRaises(ValueError): self.send()
        with self.assertRaises(ValueError): self.send(self.root)
        with self.assertRaises(ValueError): self.send(self.root / 'missing.png')

if __name__ == '__main__': unittest.main()
