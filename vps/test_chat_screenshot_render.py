"""Browser integration: real Vesper app served locally, fixture read APIs only."""
import base64
import faulthandler
import os
import subprocess
import time
import unittest
import urllib.request
from pathlib import Path
import vesper_chat_screenshot as screenshot


@unittest.skipUnless(os.environ.get('VESPER_TEST_SCREENSHOT_RENDER') == '1', 'real Chrome integration runs in screenshot CI')
class ScreenshotRenderTests(unittest.TestCase):
    def test_large_avatar_becomes_temporary_header_thumbnail(self):
        from PIL import Image
        from io import BytesIO
        source = BytesIO()
        Image.new('RGB', (1920, 1920), '#647e94').save(source, format='PNG')
        value = 'data:image/png;base64,' + base64.b64encode(source.getvalue()).decode()
        result = screenshot.capture_avatar(value)
        self.assertEqual(Image.open(BytesIO(base64.b64decode(result.split(',', 1)[1]))).size, (160, 160))
        self.assertLess(len(result), len(value))
        self.assertEqual(screenshot.capture_avatar('/avatar.png'), '/avatar.png')

    def test_hidden_broken_images_do_not_block_visible_excerpt(self):
        from playwright.sync_api import sync_playwright
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel='chrome', headless=True)
            page = browser.new_page()
            page.set_content('<main class="chat-capture"><section hidden><img src="data:image/png;base64,invalid"></section></main>')
            self.assertTrue(page.evaluate(screenshot.VISIBLE_IMAGES_READY))
            page.locator('section').evaluate('el => el.hidden = false')
            self.assertFalse(page.evaluate(screenshot.VISIBLE_IMAGES_READY))
            page.locator('img').evaluate("el => el.src = 'data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1\" height=\"1\"/>'")
            page.wait_for_function(screenshot.VISIBLE_IMAGES_READY)
            browser.close()

    def test_jpeg_from_actual_webpage(self):
        faulthandler.dump_traceback_later(75, exit=True)
        data = {'title': '截图测试', 'conversationId': 'capture-fixture', 'messageIds': ['u', 'a'], 'messages': [
            {'id': 'u', 'role': 'user', 'content': '哥哥，记得这个下午吗？\n测试消息 <script>不会执行</script>', 'createdAt': '2026-10-03T12:00:00+08:00', 'attachments': []},
            {'id': 'a', 'role': 'agent', 'content': '  记得。\n\n把这段留在相册里。  ', 'createdAt': '2026-10-03T12:01:00+08:00', 'attachments': []}]}
        history = {'conversation': {'id': data['conversationId'], 'title': data['title']}, 'messages': [dict(m, conversationId=data['conversationId'], status='delivered', metadata={'attachments': m['attachments']}) for m in data['messages']], 'tombstones': []}
        app = {'documents': {'profile': {'value': {'userName': 'Vera', 'agentName': 'Rowan'}}, 'appearance': {'value': {'accent': '#b8dce8', 'background': 'url("/backgrounds/vesper-marble-20260908.jpg")'}}}}
        with open('/tmp/vesper-capture-web.log', 'w') as log:
            server = subprocess.Popen(['npm', 'run', 'start', '--', '-H', '127.0.0.1', '-p', '5173'], stdout=log, stderr=log)
            try:
                for attempt in range(60):
                    try:
                        urllib.request.urlopen('http://127.0.0.1:5173/', timeout=2).close(); break
                    except Exception:
                        if server.poll() is not None: self.fail(Path('/tmp/vesper-capture-web.log').read_text()[-6000:])
                        time.sleep(0.5)
                result = screenshot.render_child(data, 'fixture-only-token', asset_proxy='http://127.0.0.1:5173', fixtures={'history': history, 'app': app})
                picture = base64.b64decode(result['base64'])
                self.assertTrue(picture.startswith(b'\xff\xd8'))
                self.assertGreater(len(picture), 10000)
                from io import BytesIO
                from PIL import Image
                width, height = Image.open(BytesIO(picture)).size
                self.assertEqual(width, screenshot.PHONE_WIDTH * 2)
                self.assertGreaterEqual(height, screenshot.PHONE_HEIGHT * 2)
                Path('screenshot-fixture.jpg').write_bytes(picture)
            except Exception:
                print(Path('/tmp/vesper-capture-web.log').read_text()[-6000:])
                raise
            finally:
                faulthandler.cancel_dump_traceback_later()
                server.terminate()
                try: server.wait(timeout=5)
                except subprocess.TimeoutExpired: server.kill()


if __name__ == '__main__': unittest.main()
