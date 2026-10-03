"""Render only verified chat records. No model HTML, arbitrary URL or shell input."""
import base64
import hashlib
import html
import json
import re
import subprocess
import sys
import threading
from pathlib import Path
from datetime import datetime

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
    return {'title': conversation['title'], 'messages': messages, 'messageIds': ids}


def document(data):
    # Bundle the actual default Vesper artwork so background rendering needs no
    # external request and still works while the app is closed.
    artwork = base64.b64encode((Path(__file__).parent / 'screenshot-assets' / 'vesper-marble.jpg').read_bytes()).decode('ascii')
    rows = []
    for message in data['messages']:
        own = message['role'] == 'agent'
        images = []
        for item in message['attachments']:
            if not isinstance(item, dict):
                raise ValueError('Invalid original attachment')
            key = item.get('key', '')
            if str(item.get('type', '')).startswith('image/') and re.fullmatch(r'[a-zA-Z0-9-]+\.[a-zA-Z0-9]+', key):
                images.append('<img src="https://api.vesper.r-vera.com/api/media/' + key + '">')
            else:
                images.append('<p class="file">' + html.escape(str(item.get('name', 'Attachment'))) + '</p>')
        try:
            timestamp = datetime.fromisoformat(message['createdAt'].replace('Z', '+00:00')).strftime('%H:%M')
        except ValueError:
            timestamp = message['createdAt']
        rows.append('<section class="row ' + ('own' if own else 'other') + '"><small>' + ('Rowan' if own else 'Vera') + ' · ' + html.escape(timestamp) + '</small><div class="bubble">' + ''.join(images) + '<div class="text">' + html.escape(message['content']) + '</div></div></section>')
    return '''<!doctype html><html lang="zh"><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;width:430px;padding:24px 20px 18px;color:#2b3b45;font:15px/1.75 "PingFang SC","Noto Sans CJK SC",sans-serif;
    background-color:#eaf0f5;background-image:linear-gradient(rgba(255,255,255,.16),rgba(255,255,255,.16)),url("data:image/jpeg;base64,''' + artwork + '''");background-position:center;background-size:cover}
    header{padding:0 4px 18px;border-bottom:1px solid rgba(57,76,79,.12);margin-bottom:26px}
    .brand{font-size:24px;line-height:1.2;font-weight:400;letter-spacing:.015em}header small{display:block;font-size:11px;margin-top:8px}
    .row{display:flex;flex-direction:column;align-items:flex-start;margin:28px 0}.own{align-items:flex-end;text-align:right}
    small{font-size:10px;color:#576b75;margin-bottom:7px}.bubble{max-width:88%;padding:4px;overflow-wrap:anywhere;background:transparent;border:0;border-radius:0}
    .text{white-space:pre-wrap}img{max-width:100%;max-height:420px;object-fit:contain;border-radius:14px}.file{font-size:12px}
    footer{font-size:10px;color:#576b75;border-top:1px solid rgba(57,76,79,.12);padding-top:12px;margin-top:30px;letter-spacing:.03em}
    </style><header><div class="brand">Vesper</div><small>''' + html.escape(data['title']) + '</small></header>' + ''.join(rows) + '<footer>Rowan · Vera</footer></html>'


def render(data):
    if not RENDER_LOCK.acquire(blocking=False):
        raise ScreenshotUnavailable("Screenshot renderer is busy; retry shortly")
    try:
        return _render(data)
    finally:
        RENDER_LOCK.release()


def _render(data):
    try:
        result = subprocess.run([sys.executable, __file__, '--render'], input=json.dumps(data, ensure_ascii=False), capture_output=True, text=True, timeout=40)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ScreenshotUnavailable('Screenshot renderer timed out or is unavailable') from exc
    if result.returncode:
        raise ScreenshotUnavailable('Screenshot renderer unavailable. Install Playwright Chromium and CJK fonts on the VPS; no screenshot was created.')
    output = json.loads(result.stdout)
    output.update(messageIds=data['messageIds'])
    return output


def render_child(data):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 430, 'height': 800}, device_scale_factor=2)
        # Block every request except existing Vesper media. Redirects cannot escape.
        def route_request(route):
            url = route.request.url
            if route.request.redirected_from is None and re.fullmatch(r'https://api\.vesper\.r-vera\.com/api/media/[a-zA-Z0-9-]+\.[a-zA-Z0-9]+', url):
                response = route.fetch(max_redirects=0, timeout=10000)
                if response.status != 200 or not response.headers.get('content-type', '').startswith('image/'):
                    route.abort()
                else:
                    route.fulfill(response=response)
            else:
                route.abort()
        page.route('**/*', route_request)
        page.set_content(document(data), wait_until='networkidle', timeout=25000)
        page.evaluate('document.fonts.ready')
        if not page.evaluate('Array.from(document.images).every(i => i.complete && i.naturalWidth > 0)'):
            raise ValueError('Original images failed to load')
        if page.evaluate('document.documentElement.scrollHeight') > 10000:
            raise ValueError('Excerpt is too tall; select fewer original messages')
        picture = page.locator('body').screenshot(type='jpeg', quality=82)
        browser.close()
        if len(picture) > 4 * 1024 * 1024:
            raise ValueError('Screenshot too large; select fewer messages')
        return {'mimeType': 'image/jpeg', 'base64': base64.b64encode(picture).decode(), 'digest': hashlib.sha256(picture).hexdigest()[:24]}


if __name__ == '__main__':
    print(json.dumps(render_child(json.load(sys.stdin))))
