import asyncio
import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

spec = importlib.util.spec_from_file_location('display', Path(__file__).with_name('vesper_browser_display.py'))
display = importlib.util.module_from_spec(spec)
spec.loader.exec_module(display)


class DisplayTests(unittest.IsolatedAsyncioTestCase):
    def fixture(self):
        page = SimpleNamespace(url='https://example.com/', is_closed=lambda: False,
            title=AsyncMock(return_value='Example'), evaluate=AsyncMock(return_value='Public fixture'),
            screenshot=AsyncMock(return_value=b'synthetic-jpeg'), locator=Mock(return_value='masked-inputs'))
        browser = SimpleNamespace(page=page, context=SimpleNamespace(cookies=AsyncMock(return_value=[])),
            lock=asyncio.Lock(), last=123, page_id='observed-elements-unchanged', start=AsyncMock())
        return browser, Mock(exists=Mock(return_value=False))

    async def test_auth_exact_path_and_read_only_do_not_change_mcp_auth(self):
        browser, login = self.fixture()
        @web.middleware
        async def original(request, handler):
            return web.json_response({'originalAuth': True}, status=401)
        app = web.Application(middlewares=[original])
        display.install(app, browser, login, lambda url: url, 'browser-secret')
        client = TestClient(TestServer(app))
        await client.start_server()
        self.addAsyncCleanup(client.close)
        with patch.object(display.TOKEN_PATH.__class__, 'read_text', return_value='device-secret'):
            for token in ['', 'wrong', 'browser-secret']:
                response = await client.get(display.PATH, headers={'Authorization': 'Bearer ' + token})
                self.assertEqual(response.status, 401)
            headers = {'Authorization': 'Bearer device-secret'}
            self.assertEqual((await client.post(display.PATH, headers=headers)).status, 405)
            self.assertEqual((await client.get(display.PATH, headers={**headers, 'Origin': 'https://evil.example'})).status, 403)
            response = await client.get(display.PATH, headers=headers)
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            self.assertEqual((await response.json())['state'], 'live')
            self.assertEqual((await client.get('/browser/mcp', headers=headers)).status, 401)

    async def test_passive_capture_cache_and_busy_status_preserve_model_observation(self):
        browser, login = self.fixture()
        viewer = display.LiveDisplay(browser, login, lambda url: url, 'browser-secret')
        first = await viewer.snapshot('device-secret')
        async with browser.lock:
            cached = await viewer.snapshot('device-secret')
        self.assertEqual(first['image'], cached['image'])
        self.assertEqual(first['capturedAt'], cached['capturedAt'])
        self.assertTrue(cached['busy'])
        self.assertEqual(browser.page.screenshot.await_count, 1)
        self.assertEqual(browser.last, 123)
        self.assertEqual(browser.page_id, 'observed-elements-unchanged')
        browser.start.assert_not_awaited()
        self.assertEqual(browser.page.screenshot.call_args.kwargs['mask'], ['masked-inputs'])
        browser.page = None
        self.assertEqual((await viewer.snapshot('device-secret'))['state'], 'idle')
        self.assertIsNone(viewer.cached)

    async def test_owner_login_and_visible_credentials_clear_frames(self):
        browser, login = self.fixture()
        viewer = display.LiveDisplay(browser, login, lambda url: url, 'browser-secret')
        await viewer.snapshot('device-secret')
        login.exists.return_value = True
        self.assertNotIn('image', await viewer.snapshot('device-secret'))
        self.assertIsNone(viewer.cached)
        login.exists.return_value = False
        browser.page.evaluate.return_value = 'Visible device-secret'
        self.assertEqual((await viewer.snapshot('device-secret'))['state'], 'private')
        browser.page.evaluate.return_value = 'Visible cookie-secret'
        browser.context.cookies.return_value = [{'value': 'cookie-secret'}]
        self.assertEqual((await viewer.snapshot('device-secret'))['state'], 'private')

    async def test_page_change_and_capture_failure_never_relabel_old_frame_as_live(self):
        browser, login = self.fixture()
        viewer = display.LiveDisplay(browser, login, lambda url: url, 'browser-secret')
        async def change(**kwargs):
            browser.page.url = 'https://example.com/new'
            return b'image-from-prior-page'
        browser.page.screenshot.side_effect = change
        result = await viewer.snapshot('device-secret')
        self.assertEqual(result['state'], 'working')
        self.assertNotIn('image', result)
        browser.page.screenshot.side_effect = RuntimeError('private diagnostic with credentials')
        result = await viewer.snapshot('device-secret')
        self.assertEqual(result['state'], 'unavailable')
        self.assertNotIn('private diagnostic', result['reason'])


if __name__ == '__main__':
    unittest.main()
