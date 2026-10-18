"""Passive, owner-authenticated view of Rowan's existing browser page."""
import asyncio
import base64
import hashlib
import hmac
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from aiohttp import web

TOKEN_PATH = Path('/etc/vesper-browser/display-token-sha256')
PATH = '/browser/display'
DESKTOP_PATH = '/desktop/display'
ORIGINS = {None, 'https://codex.r-vera.com', 'https://vesper.r-vera.com'}


def timestamp():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


class LiveDisplay:
    def __init__(self, browser, login, display_url, browser_token):
        self.browser, self.login = browser, login
        self.display_url, self.browser_token = display_url, browser_token
        self.lock = asyncio.Lock()
        self.cached = None
        self.cached_page = None
        self.cached_url = None
        self.captured = 0

    def clear(self):
        self.cached = self.cached_page = self.cached_url = None
        self.captured = 0

    def status(self, state, **fields):
        return {'kind': 'browser', 'state': state, 'observedAt': timestamp(),
                'busy': self.browser.lock.locked(), **fields}

    async def snapshot(self, owner_token):
        # Viewing never opens a page, navigates, refreshes element IDs, or keeps
        # an idle model browser alive. Browser ownership stays with its tools.
        page = self.browser.page
        if self.login.exists():
            self.clear()
            return self.status('owner_login', reason='Browser login is being maintained by the owner.')
        if page is None or page.is_closed():
            self.clear()
            return self.status('idle', reason='Rowan has no open browser page.')
        url = page.url
        # The existing read-only browser clears its page after each tool call.
        # A cleared page is idle, rather than a live, featureless white frame.
        if url in ('about:blank', ''):
            self.clear()
            return self.status('idle', reason='Rowan has no open browser page.')
        if page is not self.cached_page or url != self.cached_url:
            self.clear()
        if self.cached and (time.monotonic() - self.captured < 1.0 or self.lock.locked()):
            return {**self.cached, 'busy': self.browser.lock.locked(), 'observedAt': timestamp()}
        if self.lock.locked():
            return self.status('working', reason='Capturing the current page.')
        async with self.lock:
            try:
                async def capture():
                    title = (await page.title())[:300]
                    visible = await page.evaluate('() => (document.body?.innerText || "").slice(0, 300000)')
                    secrets = [self.browser_token, owner_token]
                    secrets += [c['value'] for c in await self.browser.context.cookies() if len(c['value']) >= 4]
                    # Inputs are masked below. Refuse a frame if any known
                    # credential/session value is visible in page text instead.
                    if any(s and (s in visible or s in title or s in url) for s in secrets):
                        self.clear()
                        return self.status('private', reason='A visible session credential prevents capture.')
                    picture = await page.screenshot(type='jpeg', quality=65, full_page=False,
                        mask=[page.locator('input,textarea,[contenteditable="true"]')], timeout=2500)
                    if self.login.exists() or page is not self.browser.page or page.is_closed() or page.url != url:
                        self.clear()
                        return self.status('working', reason='The browser page changed during capture.')
                    if len(picture) > 512 * 1024:
                        self.clear()
                        return self.status('unavailable', reason='The current frame is too large.')
                    result = self.status('live', title=title, url=self.display_url(url),
                        capturedAt=timestamp(), mimeType='image/jpeg', image=base64.b64encode(picture).decode())
                    self.cached, self.cached_page, self.cached_url = result, page, url
                    self.captured = time.monotonic()
                    return result
                return await asyncio.wait_for(capture(), timeout=4)
            except Exception:
                self.clear()
                return self.status('unavailable', reason='The current browser frame could not be captured. Retry shortly.')

    async def request(self, request):
        try:
            expected = TOKEN_PATH.read_text().strip()
        except OSError:
            return web.json_response({'error': 'Display pairing is unavailable.'}, status=503)
        supplied = request.headers.get('Authorization', '')
        token = supplied[7:] if supplied.startswith('Bearer ') else ''
        if len(expected) != 64 or not token or not hmac.compare_digest(hashlib.sha256(token.encode()).hexdigest(), expected):
            return web.json_response({'error': 'Unauthorized'}, status=401)
        if request.headers.get('Origin') not in ORIGINS:
            return web.json_response({'error': 'Origin rejected'}, status=403)
        if request.method != 'GET':
            return web.json_response({'error': 'Display is read-only.'}, status=405)
        return web.json_response(await self.snapshot(token), headers={'Cache-Control': 'no-store', 'Pragma': 'no-cache'})


class DesktopDisplay(LiveDisplay):
    """Capture the actual X11 root display, including every visible window."""
    def __init__(self, *args, capture=None):
        super().__init__(*args)
        self.capture = capture or self.capture_pixels

    def status(self, state, **fields):
        return {**super().status(state, **fields), 'kind': 'desktop'}

    async def capture_pixels(self):
        process = await asyncio.create_subprocess_exec(
            sys.executable, str(Path(__file__).with_name('vesper_desktop_capture.py')),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        try:
            async with asyncio.timeout(3):
                picture, _ = await process.communicate()
            if process.returncode or not picture or len(picture) > 512 * 1024:
                raise RuntimeError('Desktop capture failed.')
            return picture
        finally:
            if process.returncode is None:
                process.kill()
                await process.wait()

    async def snapshot(self, owner_token):
        if self.login.exists():
            self.clear()
            return self.status('owner_login')
        if self.cached and time.monotonic() - self.captured < 1:
            return {**self.cached, 'observedAt': timestamp()}
        if self.lock.locked():
            return self.status('working')
        async with self.lock:
            try:
                page = self.browser.page
                if page is not None and not page.is_closed() and page.url != 'about:blank':
                    async with asyncio.timeout(2):
                        visible = await page.evaluate('() => (document.body?.innerText || "").slice(0,300000)')
                        title = await page.title()
                        secrets = [owner_token, self.browser_token]
                        secrets += [c['value'] for c in await self.browser.context.cookies() if len(c['value']) >= 4]
                        if any(s and (s in visible or s in title or s in page.url) for s in secrets):
                            self.clear()
                            return self.status('private')
                picture = await self.capture()
                if self.login.exists():
                    self.clear()
                    return self.status('owner_login')
                result = self.status('live', capturedAt=timestamp(), mimeType='image/jpeg',
                    image=base64.b64encode(picture).decode())
                self.cached = result
                self.captured = time.monotonic()
                return result
            except asyncio.CancelledError:
                raise
            except Exception:
                self.clear()
                return self.status('unavailable', reason='The desktop display could not be captured.')


def install(app, browser, login, display_url, browser_token):
    display = LiveDisplay(browser, login, display_url, browser_token)
    desktop = DesktopDisplay(browser, login, display_url, browser_token)

    @web.middleware
    async def display_only(request, handler):
        # Only this exact read-only path uses Vesper's existing device token.
        # The independent browsing MCP and local login retain their own auth.
        if request.path == PATH:
            return await display.request(request)
        if request.path == DESKTOP_PATH:
            return await desktop.request(request)
        return await handler(request)

    app.middlewares.insert(0, display_only)
    app.router.add_route('*', PATH, display.request)
    app.router.add_route('*', DESKTOP_PATH, desktop.request)
    return display
