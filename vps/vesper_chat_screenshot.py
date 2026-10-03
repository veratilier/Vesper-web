"""Render only verified chat records. No model HTML, arbitrary URL or shell input."""
import base64
import hashlib
import json
import re
import subprocess
import sys
import threading
from urllib.parse import urlencode, urlparse, parse_qs, quote

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
    try:
        result = subprocess.run([sys.executable, __file__, '--render'], input=json.dumps({'data': data, 'token': token}, ensure_ascii=False), capture_output=True, text=True, timeout=40)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ScreenshotUnavailable('Screenshot renderer timed out or is unavailable') from exc
    if result.returncode:
        raise ScreenshotUnavailable('Screenshot renderer unavailable. Install Playwright, Google Chrome and CJK fonts; deploy the matching Vesper Web capture view. No screenshot was created.')
    output = json.loads(result.stdout)
    output.update(messageIds=data['messageIds'])
    return output


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


def render_child(data, token, *, asset_proxy=None, fixtures=None):
    # asset_proxy/fixtures are only supplied directly by the isolated CI test.
    # Production stdin cannot select a host, proxy or fixture.
    from playwright.sync_api import sync_playwright
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel='chrome', headless=True)
        context = browser.new_context(viewport={'width': 430, 'height': 800}, device_scale_factor=2, timezone_id='Asia/Shanghai', service_workers='block')
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
            if kind is None or route.request.redirected_from is not None:
                route.abort(); return
            headers = {k: v for k, v in route.request.headers.items() if k not in ('authorization', 'x-vesper-device-token')}
            if kind == 'history': headers['authorization'] = 'Bearer ' + token
            if kind == 'app': headers['x-vesper-device-token'] = token
            if fixtures is not None and kind in fixtures:
                payload = fixtures[kind]
                key = parse_qs(urlparse(route.request.url).query).get('key', [None])[0]
                if kind == 'app' and key:
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
        actual = page.locator('.chat-capture [data-message-id]').evaluate_all("rows => rows.map(row => ({id:row.dataset.messageId,content:row.querySelector('.message > div > p')?.textContent || ''}))")
        if actual != [{'id': m['id'], 'content': m['content']} for m in data['messages']]:
            raise ValueError('Rendered webpage messages do not match the selected originals')
        phase('fonts and images')
        page.evaluate("Promise.race([document.fonts.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Fonts did not load')),10000))])")
        page.wait_for_function('Array.from(document.querySelectorAll(".chat-capture img")).every(i => i.complete && i.naturalWidth > 0)', timeout=10000)
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
        page.set_viewport_size({'width': 430, 'height': max(300, height)})
        phase('screenshot')
        picture = target.screenshot(type='jpeg', quality=82)
        browser.close()
    if len(picture) > 4 * 1024 * 1024:
        raise ValueError('Screenshot exceeds attachment size; select fewer messages')
    return {'mimeType': 'image/jpeg', 'base64': base64.b64encode(picture).decode('ascii'), 'digest': hashlib.sha256(picture).hexdigest()[:24]}


if __name__ == '__main__' and '--render' in sys.argv:
    payload = json.load(sys.stdin)
    print(json.dumps(render_child(payload['data'], payload['token'])))
