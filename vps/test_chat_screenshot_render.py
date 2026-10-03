"""Optional real Chromium smoke test; enabled in the dedicated screenshot CI job."""
import base64
import os
import unittest
from pathlib import Path
import vesper_chat_screenshot as screenshot


@unittest.skipUnless(os.environ.get('VESPER_TEST_SCREENSHOT_RENDER') == '1', 'real Chromium smoke test runs in screenshot CI')
class ScreenshotRenderTests(unittest.TestCase):
    def test_jpeg_with_original_unicode_and_both_sides(self):
        data = {'title': 'Vesper · 真实聊天', 'messageIds': ['u', 'a'], 'messages': [
            {'id': 'u', 'role': 'user', 'content': '哥哥，记得这个下午吗？\nA real original message.', 'createdAt': '2026-10-03T12:00:00+08:00', 'attachments': []},
            {'id': 'a', 'role': 'agent', 'content': '记得。把这段留在相册里。', 'createdAt': '2026-10-03T12:01:00+08:00', 'attachments': []}]}
        result = screenshot.render(data)
        picture = base64.b64decode(result['base64'])
        self.assertTrue(picture.startswith(b'\xff\xd8'))
        self.assertGreater(len(picture), 10000)
        self.assertEqual(result['messageIds'], ['u', 'a'])
        Path('screenshot-fixture.jpg').write_bytes(picture)


if __name__ == '__main__': unittest.main()
