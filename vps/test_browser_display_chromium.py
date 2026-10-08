"""Opt-in real Chromium fixture; isolated page, no owner profile or model turn."""
import asyncio
import base64
import importlib.util
import io
import os
from pathlib import Path
from types import SimpleNamespace
import unittest


@unittest.skipUnless(os.environ.get('VESPER_TEST_BROWSER_DISPLAY') == '1', 'opt-in real Chromium fixture')
class ChromiumDisplayTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_browser_frame_and_mask_preserve_page_and_observation(self):
        from playwright.async_api import async_playwright
        from PIL import Image
        spec = importlib.util.spec_from_file_location('display', Path(__file__).with_name('vesper_browser_display.py'))
        display = importlib.util.module_from_spec(spec); spec.loader.exec_module(display)
        async with async_playwright() as pw:
            engine = await pw.chromium.launch(channel='chromium', headless=True, chromium_sandbox=True, args=['--disable-dev-shm-usage'])
            try:
                context = await engine.new_context(viewport={'width': 1100, 'height': 800})
                markup = '<title>Live display fixture</title><body style="background:#224466;color:white"><h1>Actual browser fixture</h1><input value="Private input" style="width:400px;height:80px"><p>Only synthetic content</p></body>'
                await context.route('**/*', lambda route: route.fulfill(status=200, content_type='text/html', body=markup))
                page = await context.new_page()
                await page.goto('https://display-fixture.example/')
                browser = SimpleNamespace(page=page, context=context, lock=asyncio.Lock(), last=123, page_id='existing-tool-observation')
                viewer = display.LiveDisplay(browser, SimpleNamespace(exists=lambda:False), lambda url:url, 'synthetic-browser-token')
                result = await viewer.snapshot('synthetic-device-token')
                self.assertEqual(result['state'], 'live')
                image = Image.open(io.BytesIO(base64.b64decode(result['image'])))
                self.assertEqual(image.size, (1100, 800))
                # Default screenshot mask is magenta; actual field contents are hidden.
                pixel = image.getpixel((180, 120))
                self.assertGreater(pixel[0], 200); self.assertLess(pixel[1], 80); self.assertGreater(pixel[2], 200)
                self.assertEqual(await page.locator('input').input_value(), 'Private input')
                self.assertEqual(browser.last, 123); self.assertEqual(browser.page_id, 'existing-tool-observation')
                self.assertLess(len(base64.b64decode(result['image'])), 512 * 1024)
                await page.goto('about:blank')
                self.assertEqual((await viewer.snapshot('synthetic-device-token'))['state'], 'idle')
                self.assertIsNone(viewer.cached)
            finally:
                await engine.close()


if __name__ == '__main__': unittest.main()
