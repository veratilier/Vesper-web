"""Private Bilibili import. Cookies and upstream URLs never reach the browser."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import subprocess
import threading
import time
from urllib.parse import urlparse, parse_qs

ROOT = Path(os.environ.get('VESPER_WATCH_CACHE', '/home/ubuntu/.vesper/watch-cache'))
COOKIES = os.environ.get('VESPER_BILIBILI_COOKIES', '')
LOCK = threading.Lock()
TTL = 6 * 3600
LIMIT = 2 * 1024**3

def canonical(value):
    if not isinstance(value, str) or len(value) > 2048:
        raise ValueError('请粘贴 B 站视频或番剧的完整链接。')
    u = urlparse(value.strip())
    if u.scheme != 'https' or u.hostname not in {'www.bilibili.com', 'bilibili.com', 'm.bilibili.com'} or u.username or u.password or u.port not in (None, 443):
        raise ValueError('请使用 bilibili.com 的完整 HTTPS 链接，短链接请先在浏览器打开。')
    if not re.fullmatch(r'/(?:video/(?:BV[a-zA-Z0-9]+|av[0-9]+)|bangumi/play/(?:ep|ss)[0-9]+)/?', u.path):
        raise ValueError('只支持 B 站视频和番剧播放链接。')
    page = parse_qs(u.query).get('p', ['1'])[0]
    if not page.isdigit() or not 1 <= int(page) <= 1000:
        raise ValueError('分 P 参数无效。')
    return 'https://www.bilibili.com' + u.path.rstrip('/') + '?p=' + str(int(page))

def folder(ident):
    if not re.fullmatch('[a-f0-9]{32}', ident):
        raise ValueError('视频编号无效。')
    return ROOT / ident

def save(path, data):
    tmp = path / 'state.tmp'
    tmp.write_text(json.dumps(data, ensure_ascii=False))
    tmp.replace(path / 'state.json')

def read(ident):
    path = folder(ident)
    try:
        data = json.loads((path / 'state.json').read_text())
    except (OSError, ValueError):
        raise ValueError('视频缓存不存在，请重新导入。')
    if time.time() - data['created'] > TTL:
        raise ValueError('视频缓存已过期，请重新导入。')
    if data['status'] == 'preparing' and not LOCK.locked():
        data.update(status='failed', error='服务曾重启，请重新导入。')
    return data

def prepare(ident, url):
    path = folder(ident)
    state = {'id': ident, 'status': 'preparing', 'created': time.time(), 'sourceHash': hashlib.sha256(url.encode()).hexdigest()}
    save(path, state)
    proc = None
    try:
        command = [os.environ.get('VESPER_YTDLP', 'yt-dlp'), '--ignore-config', '--no-playlist', '--playlist-items', '1',
                   '--no-warnings', '--quiet', '--no-progress', '--socket-timeout', '20', '--retries', '1',
                   '--max-filesize', '1G', '-f', 'bv[vcodec^=avc1][height<=720]+ba[ext=m4a]/b[ext=mp4]',
                   '--merge-output-format', 'mp4', '--postprocessor-args', 'Merger+ffmpeg_o:-movflags +faststart', '--write-info-json', '--write-subs', '--sub-langs', 'zh.*,en.*',
                   '--sub-format', 'srt/vtt/best', '-o', str(path / 'media.%(ext)s')]
        if COOKIES:
            if not Path(COOKIES).is_file():
                raise RuntimeError('登录态文件未配置好，请在 VPS 检查。')
            command += ['--cookies', COOKIES]
        command += ['--', url]
        proc = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        deadline = time.monotonic() + 1800
        while proc.poll() is None:
            if time.monotonic() > deadline or sum(f.stat().st_size for f in path.iterdir() if f.is_file()) > LIMIT:
                raise RuntimeError('视频准备超时或超过 2 GB 限额，请换较短的视频。')
            time.sleep(1)
        media = path / 'media.mp4'
        if proc.returncode or not media.is_file() or media.stat().st_size == 0:
            raise RuntimeError('未能获取可播放视频，请检查 B 站登录态、观看权限或更新 yt-dlp。')
        info = json.loads((path / 'media.info.json').read_text())
        state.update(status='ready', title=str(info.get('title') or 'B 站视频')[:300])
        cues = []
        for sub in sorted(path.glob('media.*.json')):
            if sub.name == 'media.info.json' or sub.stat().st_size > 2_000_000:
                continue
            try:
                for row in json.loads(sub.read_text()).get('body', []):
                    cues.append({'start': float(row['from']), 'end': float(row['to']), 'text': str(row['content'])[:2000]})
                if cues: break
            except (ValueError, KeyError, TypeError): pass
        state['cues'] = cues[:20000]
        for sub in sorted([*path.glob('media.*.srt'), *path.glob('media.*.vtt')]):
            if sub.stat().st_size <= 2_000_000:
                state['subtitleText'] = sub.read_text(encoding='utf-8')
                break
        # Remove metadata containing upstream signed URLs; retain only the playable file and text cues.
        for f in path.iterdir():
            if f.is_file() and f.name not in {'media.mp4', 'state.json'}: f.unlink()
    except Exception as exc:
        state.update(status='failed', error=str(exc) if isinstance(exc, RuntimeError) else '视频准备失败，请检查 VPS 的 yt-dlp 和 ffmpeg。')
    finally:
        if proc and proc.poll() is None:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
        if state['status'] == 'failed':
            for f in path.iterdir():
                if f.is_file(): f.unlink()
        save(path, state)
        LOCK.release()

def start(url):
    url = canonical(url)
    source_hash = hashlib.sha256(url.encode()).hexdigest()
    # Same private source within the existing TTL joins its import or reuses its file.
    for state_file in ROOT.glob('*/state.json'):
        if not re.fullmatch('[a-f0-9]{32}', state_file.parent.name): continue
        try:
            data = json.loads(state_file.read_text())
            if data.get('sourceHash') != source_hash or not 0 <= time.time() - data['created'] < TTL: continue
            ready = data.get('status') == 'ready' and (state_file.parent / 'media.mp4').is_file()
            pending = data.get('status') == 'preparing' and LOCK.locked()
            if ready or pending: return {'id': state_file.parent.name, 'status': data['status']}
        except (OSError, ValueError, KeyError, TypeError): continue
    if not LOCK.acquire(blocking=False):
        raise ValueError('另一个视频正在准备，请稍后再试。')
    try:
        ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
        for p in ROOT.iterdir():
            if p.is_dir() and re.fullmatch('[a-f0-9]{32}', p.name) and time.time() - p.stat().st_mtime > TTL:
                shutil.rmtree(p)
        if sum(f.stat().st_size for f in ROOT.glob('*/*') if f.is_file()) > 4 * 1024**3:
            raise ValueError('临时视频缓存已满，过期清理后再试。')
        ident = secrets.token_hex(16)
        path = folder(ident); path.mkdir(mode=0o700)
        save(path, {'id': ident, 'status': 'preparing', 'created': time.time(), 'sourceHash': source_hash})
        threading.Thread(target=prepare, args=(ident, url), daemon=True).start()
        return {'id': ident, 'status': 'preparing'}
    except Exception:
        LOCK.release()
        raise

def ticket(ident, expiry, secret):
    return hmac.new(secret.encode(), f'watch:{ident}:{expiry}'.encode(), hashlib.sha256).hexdigest()

def byte_range(header, size):
    if not header: return 0, size - 1, 200
    match = re.fullmatch(r'bytes=(\d*)-(\d*)', header)
    if not match or not any(match.groups()): raise ValueError('Invalid range')
    a, b = match.groups()
    start = int(a) if a else max(0, size - int(b))
    end = min(int(b), size - 1) if a and b else size - 1
    if start > end or start >= size: raise ValueError('Invalid range')
    return start, end, 206

def serve(handler, ident):
    # Scoped short-lived URL capability, never the main device credential.
    try:
        params = parse_qs(urlparse(handler.path).query)
        expiry = int(params.get('expires', ['0'])[0])
        supplied = params.get('ticket', [''])[0]
        secret = handler.watch_secret()
        if not time.time() < expiry <= time.time() + TTL + 60 or not hmac.compare_digest(supplied, ticket(ident, expiry, secret)):
            handler.send_json(401, {'error': '播放链接已过期，请重新打开视频。'}); return
        data = read(ident)
        if data['status'] != 'ready': raise ValueError('视频尚未准备完成。')
        path = folder(ident) / 'media.mp4'
        size = path.stat().st_size
        try: start_at, end, code = byte_range(handler.headers.get('Range'), size)
        except ValueError:
            handler.send_response(416); handler.send_header('Content-Range', f'bytes */{size}'); handler.end_headers(); return
        handler.send_response(code)
        handler.send_header('Content-Type', 'video/mp4')
        handler.send_header('Content-Length', str(end - start_at + 1))
        handler.send_header('Accept-Ranges', 'bytes')
        handler.send_header('Cache-Control', 'private, no-store')
        handler.send_header('Referrer-Policy', 'no-referrer')
        if code == 206: handler.send_header('Content-Range', f'bytes {start_at}-{end}/{size}')
        if handler.origin():
            handler.send_header('Access-Control-Allow-Origin', handler.origin()); handler.send_header('Vary', 'Origin')
        handler.end_headers()
        with path.open('rb') as f:
            f.seek(start_at); remaining = end - start_at + 1
            while remaining:
                chunk = f.read(min(256 * 1024, remaining))
                if not chunk: break
                handler.wfile.write(chunk); remaining -= len(chunk)
    except (BrokenPipeError, ConnectionResetError): pass
    except (ValueError, OSError): handler.send_json(404, {'error': '视频不可用，请重新导入。'})
