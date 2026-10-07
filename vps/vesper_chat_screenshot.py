"""Render only verified chat records. No model HTML, arbitrary URL or shell input."""
import base64
import hashlib
import json
import re
import subprocess
import sys
import threading
import os
import signal
from io import BytesIO
from urllib.parse import urlencode, urlparse, parse_qs, quote
from urllib.request import Request, build_opener, HTTPRedirectHandler

RENDER_LOCK = threading.BoundedSemaphore(1)


class ScreenshotUnavailable(Exception):
    pass


def select_messages(connection, conversation_id, ids):
    if not isinstance(ids, list) or not 1 <= len(ids) <= 12 or any(not isinstance(i, str) or not i or len(i) > 256 for i in ids) or len(set(ids)) != len(ids):
        raise ValueError('Choose 1–12 unique original message IDs')
    conversation = connection.execute('SELECT title FROM conversations WHERE vesper_conversation_id=? AND archived_at IS NULL', (conversation_id,)).fetchone()
    if not conversation:
        raise ValueError('Original conversation is unavailable')
    rows = connection.execute('SELECT * FROM messages WHERE vesper_conversation_id=? AND id IN (' + ','.join('?' for _ in ids) + ') ORDER BY created_at,rowid', (conversation_id, *ids)).fetchall()
    if [r['id'] for r in rows] != ids:
        raise ValueError('Messages must exist in this conversation, in chronological order')
    messages = []
    for row in rows:
        metadata = json.loads(row['metadata_json'] or '{}')
        if (row['role'] == 'user' and metadata.get('wake')) or metadata.get('sticker') or metadata.get('musicCard'):
            raise ValueError('Select visible text or photo messages; control messages and rich cards cannot be captured')
        if row['role'] not in ('user', 'agent') or metadata.get('blockType', '') not in ('', 'agentMessage', 'assistantMessage', 'userMessage', 'text') or metadata.get('hidden') or metadata.get('internal'):
            raise ValueError('Only visible original chat messages can be captured')
        messages.append({'id': row['id'], 'role': row['role'], 'content': row['content'], 'createdAt': row['created_at'], 'attachments': metadata.get('attachments', [])})
    if sum(len(m['content']) for m in messages) > 16000:
        raise ValueError('Choose a shorter excerpt; original text will not be truncated')
    return {'title': conversation['title'], 'conversationId': conversation_id, 'messages': messages, 'messageIds': ids}


def render(data, token):
    if not RENDER_LOCK.acquire(blocking=False):
        raise ScreenshotUnavailable("Screenshot renderer is busy; retry shortly")
    try:
        return _render(data, token)
    finally:
        RENDER_LOCK.release()


def _render(data, token):
    process = None
    try:
        process = subprocess.Popen([sys.executable, __file__, '--render'], stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                   start_new_session=True)
        stdout, _ = process.communicate(json.dumps({'data': data, 'token': token}, ensure_ascii=False), timeout=40)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ScreenshotUnavailable('Screenshot renderer timed out or is unavailable') from exc
    finally:
        # Chrome and the Playwright driver are grandchildren. Killing just the
        # Python process leaves them consuming memory after a timeout.
        if process is not None:
            try: os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError: pass
            process.wait()
    if process.returncode:
        raise ScreenshotUnavailable('Screenshot renderer unavailable. Install Playwright, Google Chrome and CJK fonts; deploy the matching Vesper Web capture view. No screenshot was created.')
    output = json.loads(stdout)
    output.update(messageIds=data['messageIds'])
    return output


PHONE_WIDTH = 393
PHONE_HEIGHT = 852

WEB_ORIGIN = 'https://vesper.r-vera.com'
API_ORIGIN = 'https://api.vesper.r-vera.com'
HISTORY_ORIGIN = 'https://codex.r-vera.com'


def capture_url(data):
    return WEB_ORIGIN + '/?' + urlencode([('capture', 'agent'), ('conversation', data['conversationId']), *[('message', i) for i in data['messageIds']]])


def request_policy(url, method, data):
    """Credentials are added only to the precise read endpoints, never assets."""
    parsed = urlparse(url)
    origin = parsed.scheme + '://' + parsed.netloc
    if method != 'GET' or parsed.username or parsed.password:
        return None
    if origin == HISTORY_ORIGIN and parsed.path == '/history/conversations/' + quote(data['conversationId'], safe=''):
        if parse_qs(parsed.query).get('captureMessageId') == data['messageIds']:
            return 'history'
        return None
    if origin == API_ORIGIN and parsed.path == '/api/state':
        return 'app'
    if origin in (API_ORIGIN, WEB_ORIGIN) and re.fullmatch(r'/api/media/[a-zA-Z0-9-]+\.[a-zA-Z0-9]+', parsed.path):
        return 'media'
    if origin == WEB_ORIGIN and not parsed.path.startswith('/api/'):
        return 'asset'
    return None


VISIBLE_IMAGES_READY = 'Array.from(document.querySelectorAll(".chat-capture img")).filter(i => i.checkVisibility()).every(i => i.complete && i.naturalWidth > 0)'


def capture_history(data):
    """Serve the exact database snapshot already authorized by select_messages.

    Rendering must not re-fetch the same history through the public proxy: that
    adds a second network/auth boundary and can race later edits to the records.
    """
    return {
        'conversation': {'id': data['conversationId'], 'title': data['title']},
        'messages': [dict(m, conversationId=data['conversationId'], status='delivered',
                          metadata={'attachments': m.get('attachments', [])}) for m in data['messages']],
        'tombstones': [], 'hasMore': False,
    }


def capture_appearance(token):
    # Fetch once before routing the page, avoiding nested synchronous route.fetch
    # calls for every mounted (including hidden) section of the application.
    class NoRedirects(HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    request = Request(API_ORIGIN + '/api/state', headers={
        'x-vesper-device-token': token, 'User-Agent': 'Vesper-Capture/1.0',
    })
    with build_opener(NoRedirects()).open(request, timeout=10) as response:
        state = json.load(response)
    documents = {key: value for key, value in state['documents'].items()
                 if key in ('profile', 'appearance')}
    profile = documents.get('profile', {}).get('value')
    if isinstance(profile, dict):
        profile = dict(profile)
        for key in ('userAvatar', 'agentAvatar'):
            profile[key] = capture_avatar(profile.get(key, ''))
        documents['profile'] = dict(documents['profile'], value=profile)
    return {'documents': documents}


def capture_avatar(value):
    # Uploaded avatars can be multi-megabyte originals. The header displays
    # 40 CSS pixels; keep a 4x thumbnail only in this transient capture snapshot.
    if not isinstance(value, str) or not re.match(r'^data:image/(png|jpe?g|webp);base64,', value):
        return value
    from PIL import Image, ImageOps
    with Image.open(BytesIO(base64.b64decode(value.split(',', 1)[1]))) as original:
        image = ImageOps.exif_transpose(original)
        image.thumbnail((160, 160))
        output = BytesIO()
        image.convert('RGBA').save(output, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(output.getvalue()).decode('ascii')


def render_child(data, token, *, asset_proxy=None, fixtures=None):
    # asset_proxy/fixtures are only supplied directly by the isolated CI test.
    # Production stdin cannot select a host, proxy or fixture.
    from playwright.sync_api import sync_playwright
    appearance = fixtures['app'] if fixtures is not None else capture_appearance(token)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel='chrome', headless=True)
        context = browser.new_context(viewport={'width': PHONE_WIDTH, 'height': PHONE_HEIGHT}, device_scale_factor=2, timezone_id='Asia/Shanghai', service_workers='block')
        # A routed socket without connect_to_server is isolated and drops its
        # messages. Closing inside the route callback can stall Chrome's route
        # handshake; no actual backend connection is made here.
        context.route_web_socket('**/*', lambda socket: None)
        context.add_init_script("localStorage.setItem('vesper-device-token','capture-session');")
        loaded = {'history': False, 'app': False}
        def route_request(route):
            if route.request.method == 'OPTIONS' and request_policy(route.request.url, 'GET', data) in ('history', 'app', 'media'):
                route.fulfill(status=204, headers={'access-control-allow-origin': WEB_ORIGIN, 'access-control-allow-methods': 'GET', 'access-control-allow-headers': 'authorization,content-type,x-vesper-device-token'}); return
            kind = request_policy(route.request.url, route.request.method, data)
            if kind == 'asset' and urlparse(route.request.url).path.startswith('/opening/'):
                # The capture has no opening animation; avoid decoding its large
                # initial SSR images before the client switches to chat mode.
                route.abort(); return
            if kind is None or route.request.redirected_from is not None:
                route.abort(); return
            if kind == 'history':
                route.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': WEB_ORIGIN}, body=json.dumps(capture_history(data), ensure_ascii=False))
                loaded['history'] = True; return
            headers = {k: v for k, v in route.request.headers.items() if k not in ('authorization', 'x-vesper-device-token')}
            if kind == 'app':
                payload = appearance
                key = parse_qs(urlparse(route.request.url).query).get('key', [None])[0]
                if key:
                    payload = {'key': key, 'value': payload['documents'].get(key, {}).get('value'), 'updatedAt': '2026-10-03T12:00:00+08:00'}
                route.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': WEB_ORIGIN}, body=json.dumps(payload, ensure_ascii=False))
                loaded[kind] = True; return
            url = route.request.url
            if asset_proxy and kind == 'asset':
                parsed = urlparse(url)
                url = asset_proxy + parsed.path + ('?' + parsed.query if parsed.query else '')
                # Dev servers reject a forwarded production Origin. This is
                # confined to the isolated local-application integration test.
                headers['origin'] = asset_proxy
                headers['referer'] = asset_proxy + '/'
            response = route.fetch(url=url, headers=headers, max_redirects=0, timeout=15000)
            if response.status != 200:
                route.abort(); return
            if kind in loaded: loaded[kind] = True
            route.fulfill(response=response)
        context.route('**/*', route_request)
        page = context.new_page()
        def phase(name):
            if fixtures is not None: print('Capture fixture phase:', name, file=sys.stderr, flush=True)
        if fixtures is not None:
            page.on('pageerror', lambda error: print('Capture fixture page error:', str(error), file=sys.stderr))
            page.on('console', lambda message: print('Capture fixture console:', message.text[:600], file=sys.stderr) if message.type == 'error' else None)
        phase('navigation')
        page.goto(capture_url(data), wait_until='domcontentloaded', timeout=20000)
        phase('chat readiness')
        try:
            page.locator('.chat-capture[data-capture-ready="true"] .codex-chat[data-capture-history="ready"]').wait_for(timeout=20000)
        except Exception:
            if fixtures is not None:
                print('Capture fixture DOM:', page.locator('body').inner_text()[:2000], 'Read APIs:', loaded, file=sys.stderr)
            raise
        if not all(loaded.values()): raise ValueError('Authenticated theme or original history failed to load')
        phase('original text verification')
        # Verify that the real UI rendered precisely the selected original text.
        actual = page.locator('.chat-capture [data-message-id]').evaluate_all("rows => rows.map(row => ({id:row.dataset.messageId,content:Array.from(row.querySelectorAll('[data-capture-text]')).map(p => p.textContent).join('')}))")
        if actual != [{'id': m['id'], 'content': m['content']} for m in data['messages']]:
            raise ValueError('Rendered webpage messages do not match the selected originals')
        if not page.locator('.chat-capture [data-message-id]').evaluate_all("""rows => rows.every(row => {
            if (row.dataset.captureLayout !== 'bubbles-v2') return false;
            if (!Array.from(row.querySelectorAll('.capture-whitespace')).every(el => !el.textContent.trim())) return false;
            const r = row.getBoundingClientRect(), own = row.classList.contains('agent-turn');
            return Array.from(row.querySelectorAll('.text-bubble-target')).every(bubble => {
                const b = bubble.getBoundingClientRect();
                return own ? Math.abs(b.right - r.right) < 4 : Math.abs(b.left - r.left) < 4;
            });
        })"""):
            raise ValueError('Webpage capture layout is outdated or has the wrong perspective')
        # Both the text and its actual timestamp must follow the chosen side.
        if not page.locator('.chat-capture [data-message-id]').evaluate_all("""rows => rows.every(row => {
            const stamp = row.querySelector('.capture-message-time');
            const text = row.querySelector('p[data-capture-text]');
            if (!stamp || getComputedStyle(stamp).opacity !== "1" || getComputedStyle(stamp).animationName !== "none") return false;
            const r = row.getBoundingClientRect(), t = stamp.getBoundingClientRect();
            const own = row.classList.contains('agent-turn');
            return (!text || getComputedStyle(text).fontSize === '17px') &&
                (own ? Math.abs(t.right - r.right) < 4 : Math.abs(t.left - r.left) < 4);
        })"""):
            raise ValueError('Capture timestamp alignment or phone text sizing was not applied')
        phase('fonts and images')
        page.evaluate("Promise.race([document.fonts.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Fonts did not load')),10000))])")
        page.wait_for_function(VISIBLE_IMAGES_READY, timeout=10000)
        # Wait for the actual saved background, including a data-URI upload.
        page.evaluate(r"""async () => {
          const bg = getComputedStyle(document.querySelector('.chat-capture')).backgroundImage;
          await Promise.race([Promise.all([...bg.matchAll(/url\(["']?(.+?)["']?\)/g)].map(match => new Promise((resolve,reject) => {
            const image = new Image(); image.onload=resolve; image.onerror=reject; image.src=match[1];
          }))), new Promise((_,reject)=>setTimeout(()=>reject(new Error('Background did not load')),10000))]);
        }""")
        target = page.locator('.chat-capture > .app-shell')
        height = target.evaluate('el => Math.ceil(el.scrollHeight)')
        if height > 10000: raise ValueError('Excerpt is too tall; select fewer original messages')
        page.set_viewport_size({'width': PHONE_WIDTH, 'height': max(PHONE_HEIGHT, height)})
        phase('screenshot')
        picture = target.screenshot(type='jpeg', quality=82)
        browser.close()
    if len(picture) > 4 * 1024 * 1024:
        raise ValueError('Screenshot exceeds attachment size; select fewer messages')
    return {'mimeType': 'image/jpeg', 'base64': base64.b64encode(picture).decode('ascii'), 'digest': hashlib.sha256(picture).hexdigest()[:24]}


if __name__ == '__main__' and '--render' in sys.argv:
    payload = json.load(sys.stdin)
    print(json.dumps(render_child(payload['data'], payload['token'])))
