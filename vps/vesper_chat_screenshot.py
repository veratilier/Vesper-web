"""Render only verified chat records. No model HTML, arbitrary URL or shell input."""
import base64
import hashlib
import html
import json
import re
import subprocess
import sys
import threading

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
        rows.append('<section class="row ' + ('own' if own else 'other') + '"><small>' + ('Rowan' if own else 'Vera') + ' · ' + html.escape(message['createdAt']) + '</small><div class="bubble">' + ''.join(images) + '<div class="text">' + html.escape(message['content']) + '</div></div></section>')
    return '''<!doctype html><html lang="zh"><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;background:#f7f8fb;color:#222;font:16px/1.65 Arial,"Noto Sans CJK SC",sans-serif;width:430px;padding:24px 18px}
    header{font-size:18px;text-align:center;padding:0 0 20px;border-bottom:1px solid #dbe0e8;margin-bottom:20px}
    header small{display:block;font-size:11px;color:#627080}.row{display:flex;flex-direction:column;align-items:flex-start;margin:18px 0}.own{align-items:flex-end}
    small{font-size:10px;color:#69788a;margin-bottom:5px}.bubble{max-width:88%;border-radius:17px;background:white;padding:12px 15px;overflow-wrap:anywhere}.own .bubble{background:#e0eaf5}.text{white-space:pre-wrap}img{max-width:100%;max-height:420px;object-fit:contain;border-radius:9px}.file{font-size:12px}footer{text-align:center;font-size:10px;color:#718098;margin-top:24px}
    </style><header>''' + html.escape(data['title']) + '<small>Rowan’s view · Selected original messages</small></header>' + ''.join(rows) + '<footer>Vesper</footer></html>'


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
        picture = page.screenshot(type='jpeg', quality=82, full_page=True)
        browser.close()
        if len(picture) > 4 * 1024 * 1024:
            raise ValueError('Screenshot too large; select fewer messages')
        return {'mimeType': 'image/jpeg', 'base64': base64.b64encode(picture).decode(), 'digest': hashlib.sha256(picture).hexdigest()[:24]}


if __name__ == '__main__':
    print(json.dumps(render_child(json.load(sys.stdin))))
