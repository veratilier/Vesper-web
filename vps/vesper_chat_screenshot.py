"""Render verified original chat records directly, without opening Vesper Web."""
import base64
import hashlib
import io
import json
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import threading
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

RENDER_LOCK = threading.BoundedSemaphore(1)
PHONE_WIDTH = 786
MAX_HEIGHT = 18000
MAX_BYTES = 4 * 1024 * 1024
MAX_MEDIA_BYTES = 8 * 1024 * 1024
MEDIA_HOSTS = {'api.vesper.r-vera.com', 'vesper.r-vera.com'}
ASSET = Path(__file__).with_name('vesper-chat-background.jpg')
WHITE_ASSET = Path(__file__).with_name('vesper-chat-background-white.jpg')
BLACK_ASSET = Path(__file__).with_name('vesper-chat-background-black.jpg')
APPEARANCE_URL = 'https://api.vesper.r-vera.com/api/state?key=chatCaptureAppearance'


class ScreenshotUnavailable(Exception):
    pass


def select_messages(connection: sqlite3.Connection, conversation_id: str, ids: list[str]) -> dict:
    if (not isinstance(ids, list) or not 1 <= len(ids) <= 12
            or any(not isinstance(i, str) or not i or len(i) > 256 for i in ids)
            or len(set(ids)) != len(ids)):
        raise ValueError('Choose 1–12 unique original message IDs')
    conversation = connection.execute(
        'SELECT title FROM conversations WHERE vesper_conversation_id=? AND archived_at IS NULL',
        (conversation_id,)).fetchone()
    if not conversation:
        raise ValueError('Original conversation is unavailable')
    rows = connection.execute(
        'SELECT * FROM messages WHERE vesper_conversation_id=? AND id IN ('
        + ','.join('?' for _ in ids) + ') ORDER BY created_at,rowid',
        (conversation_id, *ids)).fetchall()
    if [r['id'] for r in rows] != ids:
        raise ValueError('Messages must exist in this conversation, in chronological order')
    messages = []
    for row in rows:
        metadata = json.loads(row['metadata_json'] or '{}')
        if (row['role'] == 'user' and metadata.get('wake')) or metadata.get('sticker') or metadata.get('musicCard'):
            raise ValueError('Select visible text or photo messages; control messages and rich cards cannot be captured')
        if (row['role'] not in ('user', 'agent')
                or metadata.get('blockType', '') not in ('', 'agentMessage', 'assistantMessage', 'userMessage', 'text')
                or metadata.get('hidden') or metadata.get('internal')):
            raise ValueError('Only visible original chat messages can be captured')
        attachments = metadata.get('attachments', [])
        if not isinstance(attachments, list) or len(attachments) > 12:
            raise ValueError('Invalid original photo attachments')
        if any(not isinstance(a, dict) or not str(a.get('type', '')).startswith('image/') for a in attachments):
            raise ValueError('Only original photo attachments can be captured')
        explicit = metadata.get('bubbles', [])
        text_bubbles = ([bubble.get('text') for bubble in explicit]
                        if isinstance(explicit, list) and explicit
                        and all(isinstance(bubble, dict) and isinstance(bubble.get('text'), str) for bubble in explicit)
                        else [])
        if text_bubbles and '\n\n'.join(text_bubbles) != row['content']:
            text_bubbles = []
        messages.append({
            'id': row['id'], 'role': row['role'], 'content': row['content'],
            'createdAt': row['created_at'], 'attachments': attachments, 'textBubbles': text_bubbles,
        })
    if sum(len(m['content']) for m in messages) > 16000:
        raise ValueError('Choose a shorter excerpt; original text will not be truncated')
    return {'title': conversation['title'], 'conversationId': conversation_id,
            'messages': messages, 'messageIds': ids}


def render(data: dict, token: str) -> dict:
    # The token stays in the history service. Original media URLs are public,
    # fixed-origin reads; neither the model nor the image renderer gets the token.
    if not RENDER_LOCK.acquire(blocking=False):
        raise ScreenshotUnavailable('Screenshot renderer is busy; retry shortly')
    try:
        data = {**data, 'appearance': _capture_appearance(token)}
        result = subprocess.run(
            [sys.executable, __file__, '--render'], input=json.dumps(data, ensure_ascii=False),
            capture_output=True, text=True, timeout=40,
        )
        if result.returncode:
            raise ScreenshotUnavailable('Screenshot renderer is unavailable')
        output = json.loads(result.stdout)
        if 'error' in output:
            raise ScreenshotUnavailable(output['error'])
        output['messageIds'] = data['messageIds']
        return output
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        raise ScreenshotUnavailable('Screenshot renderer timed out or is unavailable') from exc
    finally:
        RENDER_LOCK.release()


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def _capture_appearance(token: str) -> dict:
    fallback = {'palette': 'blue', 'shade': 0.16, 'backgroundUrl': '',
                'glassStyle': 'classic', 'glassFrost': False,
                'glassTransparency': 0.0, 'reduceTransparency': False}
    try:
        request = Request(APPEARANCE_URL, headers={
            'x-vesper-device-token': token, 'Accept': 'application/json',
            'User-Agent': 'VesperHistory/1.0',
        })
        with build_opener(_NoRedirect()).open(request, timeout=5) as response:
            if response.status != 200:
                return fallback
            value = json.load(response).get('value')
        if not isinstance(value, dict):
            return fallback
        palette = value.get('palette')
        shade = value.get('shade')
        background = value.get('backgroundUrl')
        if palette not in ('blue', 'white', 'black') or not isinstance(shade, (int, float)) or not 0 <= shade <= 0.7:
            return fallback
        if not isinstance(background, str) or len(background) > 1024:
            return fallback
        if background:
            # The image subprocess performs the exact fixed-origin media check.
            parsed = urlparse(background)
            if parsed.scheme != 'https' or parsed.hostname not in MEDIA_HOSTS or not parsed.path.startswith('/api/media/'):
                return fallback
        style = value.get('glassStyle', 'classic')
        frost = value.get('glassFrost', False)
        transparency = value.get('glassTransparency', 0.0)
        reduce_transparency = value.get('reduceTransparency', False)
        if (style not in ('liquid', 'classic') or not isinstance(frost, bool)
                or isinstance(transparency, bool) or not isinstance(transparency, (int, float))
                or not 0 <= transparency <= 1 or not isinstance(reduce_transparency, bool)):
            return fallback
        return {'palette': palette, 'shade': shade, 'backgroundUrl': background,
                'glassStyle': style, 'glassFrost': frost,
                'glassTransparency': transparency, 'reduceTransparency': reduce_transparency}
    except (OSError, ValueError, KeyError, TypeError):
        return fallback


def _photo_bytes(attachment: dict) -> bytes:
    url = str(attachment.get('url') or '')
    parsed = urlparse(url)
    if (parsed.scheme != 'https' or parsed.hostname not in MEDIA_HOSTS
            or parsed.port is not None or parsed.username or parsed.password
            or not re.fullmatch(r'/api/media/[a-zA-Z0-9-]+\.[a-zA-Z0-9]+', parsed.path)
            or parsed.query or parsed.fragment):
        raise ScreenshotUnavailable('Original photo URL is unavailable for capture')
    try:
        with build_opener(_NoRedirect()).open(
            Request(url, headers={'Accept': 'image/*', 'User-Agent': 'VesperHistory/1.0'}), timeout=7
        ) as response:
            if response.status != 200 or not response.headers.get('content-type', '').startswith('image/'):
                raise ScreenshotUnavailable('Original photo could not be loaded')
            payload = response.read(MAX_MEDIA_BYTES + 1)
    except ScreenshotUnavailable:
        raise
    except Exception as exc:
        raise ScreenshotUnavailable('Original photo could not be loaded') from exc
    if len(payload) > MAX_MEDIA_BYTES:
        raise ScreenshotUnavailable('Original photo is too large to capture')
    return payload


def _font(size: int):
    from PIL import ImageFont
    candidates = (
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
        '/System/Library/Fonts/PingFang.ttc',
        '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
    )
    for path in candidates:
        if Path(path).is_file():
            return ImageFont.truetype(path, size)
    raise ScreenshotUnavailable('A Chinese font is required for chat screenshots')


def _lines(content: str, font, max_width: int) -> list[str]:
    # Pixel measured wrapping preserves original words, line breaks and symbols.
    result = []
    for paragraph in content.replace('\r\n', '\n').split('\n'):
        if not paragraph:
            result.append('')
            continue
        rest = paragraph
        while rest:
            low, high = 1, len(rest)
            while low < high:
                middle = (low + high + 1) // 2
                if font.getlength(rest[:middle]) <= max_width:
                    low = middle
                else:
                    high = middle - 1
            count = max(1, low)
            if count < len(rest):
                break_at = max(rest.rfind(' ', 0, count + 1), rest.rfind('\t', 0, count + 1))
                if break_at > count // 2:
                    count = break_at + 1
            result.append(rest[:count])
            rest = rest[count:]
    return result


def _load_photos(attachments: list[dict]) -> list:
    from PIL import Image, ImageOps, UnidentifiedImageError
    Image.MAX_IMAGE_PIXELS = 20_000_000
    photos = []
    for attachment in attachments:
        try:
            payload = _photo_bytes(attachment)
            with Image.open(io.BytesIO(payload)) as source:
                picture = ImageOps.exif_transpose(source).convert('RGB')
                picture.thumbnail((560, 620), Image.Resampling.LANCZOS)
                photos.append(picture)
        except (UnidentifiedImageError, OSError, ValueError) as exc:
            raise ScreenshotUnavailable('Original photo could not be decoded') from exc
    return photos


def _draw_glass_bubble(canvas, box: tuple[int, int, int, int], role: str,
                       palette: str, appearance: dict) -> None:
    from PIL import Image, ImageDraw, ImageFilter
    left, top, right, bottom = box
    size = (right - left, bottom - top)
    mask = Image.new('L', size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=34, fill=255)
    original = canvas.crop(box)
    dark = palette == 'black'
    outgoing = role == 'agent'
    if appearance.get('reduceTransparency', False):
        blur_radius, blur_mix = 0, 0
        tint = (30, 30, 30, 255) if dark else (255, 255, 255, 255)
        border_alpha = 70
    elif appearance.get('glassStyle') == 'liquid':
        hazy = appearance.get('glassFrost', False)
        blur_radius, blur_mix = (12, 0.78) if hazy else (2, 0.3)
        if dark:
            tint = (230, 230, 230, 55 if hazy else 27)
        elif outgoing:
            tint = (159, 198, 220, 118 if hazy else 72)
        else:
            tint = (255, 255, 255, 120 if hazy else 64)
        border_alpha = 150 if hazy else 175
    else:
        transparency = appearance.get('glassTransparency', 0.0)
        strength = 1 - max(0, min(1, transparency))
        blur_radius, blur_mix = 13, 0.84 * strength
        if dark:
            tint = (230, 230, 230, round(70 * strength))
        elif outgoing:
            tint = (171, 205, 224, round(143 * strength))
        else:
            tint = (255, 255, 255, round(169 * strength))
        border_alpha = round(130 * strength)
    glass = Image.blend(original, original.filter(ImageFilter.GaussianBlur(blur_radius)), blur_mix) if blur_mix else original
    glass = Image.alpha_composite(glass, Image.new('RGBA', size, tint))
    if border_alpha:
        edge = Image.new('RGBA', size, (0, 0, 0, 0))
        ImageDraw.Draw(edge).rounded_rectangle(
            (1, 1, size[0] - 2, size[1] - 2), radius=33,
            outline=(255, 255, 255, border_alpha) if not dark else (255, 255, 255, border_alpha // 2), width=2)
        glass = Image.alpha_composite(glass, edge)
    canvas.paste(glass, (left, top), mask)


def render_child(data: dict) -> dict:
    from PIL import Image, ImageDraw, ImageOps
    appearance = data.get('appearance') or {}
    palette = appearance.get('palette', 'blue')
    asset = {'blue': ASSET, 'white': WHITE_ASSET, 'black': BLACK_ASSET}.get(palette, ASSET)
    background_url = appearance.get('backgroundUrl', '')
    if not background_url and not asset.is_file():
        raise ScreenshotUnavailable('Chat screenshot background is unavailable')
    body_font = _font(30)
    line_height = 43
    edge = 40
    bubble_max = 624
    blocks = []
    y = 44
    for message in data['messages']:
        role = message['role']
        photos = _load_photos(message.get('attachments') or [])
        for photo in photos:
            x = PHONE_WIDTH - edge - photo.width if role == 'agent' else edge
            blocks.append(('photo', x, y, photo.width, photo.height, photo, role))
            y += photo.height + 16
        content = message.get('content') or ''
        bubbles = message.get('textBubbles') or [
            part for part in re.split(r'\n[ \t]*\n', content) if part
        ]
        for text in bubbles:
            if not text:
                continue
            lines = _lines(text, body_font, bubble_max - 56)
            text_width = max((body_font.getlength(line) for line in lines), default=0)
            width = max(100, min(bubble_max, int(text_width + 56)))
            height = len(lines) * line_height + 34
            x = PHONE_WIDTH - edge - width if role == 'agent' else edge
            blocks.append(('text', x, y, width, height, lines, role))
            y += height + 16
        if not photos and not bubbles:
            raise ScreenshotUnavailable('A selected original message is empty')
        y += 8
        if y > MAX_HEIGHT:
            raise ScreenshotUnavailable('Excerpt is too tall; select fewer original messages')
    height = max(420, y + 28)
    if background_url:
        source_bytes = _photo_bytes({'url': background_url})
        source = Image.open(io.BytesIO(source_bytes))
    else:
        source = Image.open(asset)
    with source:
        canvas = ImageOps.fit(ImageOps.exif_transpose(source).convert('RGB'),
                              (PHONE_WIDTH, height), method=Image.Resampling.LANCZOS).convert('RGBA')
    shade = appearance.get('shade', 0.28)
    shade = max(0, min(0.7, float(shade))) if isinstance(shade, (float, int)) else 0.28
    tint = (0, 0, 0, round(shade * 255)) if palette == 'black' else (255, 255, 255, round(shade * 255))
    canvas = Image.alpha_composite(canvas, Image.new('RGBA', canvas.size, tint))
    for kind, x, top, width, h, value, role in blocks:
        if kind == 'photo':
            rounded = Image.new('L', value.size)
            ImageDraw.Draw(rounded).rounded_rectangle((0, 0, width, h), radius=30, fill=255)
            canvas.paste(value.convert('RGBA'), (x, top), rounded)
            continue
        _draw_glass_bubble(canvas, (x, top, x + width, top + h), role, palette, appearance)
        draw = ImageDraw.Draw(canvas)
        for index, line in enumerate(value):
            draw.text((x + 28, top + 14 + index * line_height), line, font=body_font,
                      fill='#f0f0f0' if palette == 'black' else '#20242b')
    image = canvas.convert('RGB')
    output = io.BytesIO()
    image.save(output, 'JPEG', quality=83, optimize=True)
    picture = output.getvalue()
    if len(picture) > MAX_BYTES:
        raise ScreenshotUnavailable('Screenshot exceeds attachment size; select fewer messages')
    return {
        'mimeType': 'image/jpeg', 'base64': base64.b64encode(picture).decode('ascii'),
        'digest': hashlib.sha256(picture).hexdigest()[:24],
    }


if __name__ == '__main__' and '--render' in sys.argv:
    try:
        print(json.dumps(render_child(json.load(sys.stdin)), ensure_ascii=False))
    except (ScreenshotUnavailable, ValueError) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False))
