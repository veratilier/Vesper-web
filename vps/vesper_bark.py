"""Bark delivery for completed turns, independent of the phone's socket lifetime."""
import base64
import hashlib
import hmac
import json
import os
import sqlite3
import threading
import time
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, quote, urljoin
from urllib.request import Request, urlopen

SCHEMA = '''
CREATE TABLE IF NOT EXISTS bark_settings(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bark_events(id TEXT PRIMARY KEY, room TEXT NOT NULL, body TEXT NOT NULL, completed REAL NOT NULL, status TEXT NOT NULL, error TEXT);
CREATE TABLE IF NOT EXISTS bark_cursors(thread TEXT PRIMARY KEY, path TEXT NOT NULL, inode INTEGER NOT NULL, offset INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bark_presence(device TEXT PRIMARY KEY, sequence INTEGER NOT NULL, room TEXT NOT NULL, visible INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bark_views(device TEXT NOT NULL, room TEXT NOT NULL, started REAL NOT NULL, expires REAL NOT NULL, closed REAL);
'''
ROOT = Path(os.environ.get('VESPER_BARK_STORAGE', str(Path.home() / '.vesper/bark')))
PUBLIC = os.environ.get('VESPER_BARK_PUBLIC_BASE', 'https://codex.r-vera.com/history').rstrip('/')
API_ORIGIN = os.environ.get('VESPER_API_ORIGIN', 'https://api.vesper.r-vera.com').rstrip('/')
_started = False
_lock = threading.Lock()


def settings(con):
    for statement in SCHEMA.split(";"):
        if statement.strip(): con.execute(statement)
    row = con.execute('SELECT value FROM bark_settings WHERE id=1').fetchone()
    return json.loads(row[0]) if row else {'enabled': False, 'address': '', 'since': time.time(), 'name': 'Vesper', 'icon': ''}


def store_settings(con, value):
    con.execute('INSERT INTO bark_settings(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', (json.dumps(value, ensure_ascii=False),))


def validate_address(value):
    if not isinstance(value, str) or len(value) > 500:
        raise ValueError('Invalid Bark address')
    value = value.strip().rstrip('/')
    parsed = urlparse(value)
    # The supplied service uses api.day.app. Restrict destinations to avoid arbitrary server fetches.
    if parsed.scheme != 'https' or parsed.hostname != 'api.day.app' or parsed.port not in (None, 443) or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('Use an https://api.day.app/device-key address')
    key = parsed.path.strip('/')
    if not key or len(key) > 128 or not all(c.isalnum() or c in '_-' for c in key):
        raise ValueError('Invalid Bark device key')
    return 'https://api.day.app/' + key


def configure(con, body):
    old = settings(con)
    enabled = body.get('enabled')
    if not isinstance(enabled, bool):
        raise ValueError('enabled must be boolean')
    address = validate_address(body.get('address', old['address'])) if enabled or body.get('address') else ''
    since = time.time() if enabled and (not old['enabled'] or address != old['address']) else old['since']
    new = {**old, 'enabled': enabled, 'address': address, 'since': since}
    store_settings(con, new)
    return new


def presence(con, body, now=None):
    now = time.time() if now is None else now
    settings(con)
    device, room, seq, visible = body.get('deviceId'), body.get('conversationId'), body.get('sequence'), body.get('visible')
    if not isinstance(device, str) or not 1 <= len(device) <= 100 or not isinstance(room, str) or not 1 <= len(room) <= 160 or type(seq) is not int or seq < 0 or not isinstance(visible, bool):
        raise ValueError('Invalid chat visibility')
    previous = con.execute('SELECT * FROM bark_presence WHERE device=?', (device,)).fetchone()
    if previous and previous['sequence'] >= seq:
        return
    same = previous and previous['visible'] and visible and previous['room'] == room
    if same:
        con.execute('UPDATE bark_views SET expires=? WHERE device=? AND room=? AND closed IS NULL', (now + 35, device, room))
    else:
        con.execute('UPDATE bark_views SET closed=? WHERE device=? AND closed IS NULL', (now, device))
        if visible:
            con.execute('INSERT INTO bark_views(device,room,started,expires) VALUES(?,?,?,?)', (device, room, now, now + 35))
    con.execute('INSERT INTO bark_presence VALUES(?,?,?,?) ON CONFLICT(device) DO UPDATE SET sequence=excluded.sequence,room=excluded.room,visible=excluded.visible', (device, seq, room, int(visible)))
    con.execute('DELETE FROM bark_views WHERE expires<?', (now - 3600,))


def watching(con, room, at):
    return bool(con.execute('SELECT 1 FROM bark_views WHERE room=? AND started<=? AND expires>=? AND (closed IS NULL OR closed>=?) LIMIT 1', (room, at, at, at)).fetchone())


def icon_ticket(digest, token):
    return hmac.new(token.encode(), ('bark-avatar:' + digest).encode(), hashlib.sha256).hexdigest()


def set_profile(con, profile, token):
    config = settings(con)
    name = profile.get('agentName')
    if isinstance(name, str) and name.strip():
        config['name'] = name.strip()[:80]
    source = profile.get('agentAvatar', '')
    config['icon'] = ''
    if isinstance(source, str) and source.startswith('data:image/') and ';base64,' in source:
        try:
            raw = base64.b64decode(source.split(';base64,', 1)[1], validate=True)
            if 0 < len(raw) <= 512_000 and raw.startswith((b'\xff\xd8', b'\x89PNG\r\n\x1a\n')):
                digest = hashlib.sha256(raw).hexdigest()
                ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
                path = ROOT / (digest + '.image')
                if not path.exists():
                    path.write_bytes(raw); path.chmod(0o600)
                config['icon'] = PUBLIC + '/notifications/bark/icon/' + digest + '?ticket=' + icon_ticket(digest, token)
        except (ValueError, TypeError):
            pass
    elif isinstance(source, str) and source:
        candidate = urljoin(API_ORIGIN + '/', source)
        parsed = urlparse(candidate)
        if parsed.scheme == 'https' and parsed.hostname and not parsed.username and not parsed.password:
            config['icon'] = candidate
    store_settings(con, config)
    return config


def load_profile(token):
    request = Request(API_ORIGIN + '/api/state?key=profile', headers={'x-vesper-device-token': token, 'User-Agent': 'curl/8.5.0'})
    with urlopen(request, timeout=8) as response:
        data = response.read(1_200_001)
    if len(data) > 1_200_000:
        raise ValueError('Profile is too large')
    return json.loads(data).get('value', {})


def send(config, body, room='', sender=None):
    address = validate_address(config['address'])
    payload = {'device_key': address.rsplit('/', 1)[1], 'title': config.get('name') or 'Vesper',
               'body': body[:240], 'group': 'vesper-' + (room or 'test'),
               'url': 'vesper://chat?backend=vps' + ('&conversationId=' + quote(room, safe='') if room else '')}
    if config.get('icon'):
        payload['icon'] = config['icon']
    if sender:
        return sender(payload)
    request = Request('https://api.day.app/push', data=json.dumps(payload, ensure_ascii=False).encode(), headers={'Content-Type': 'application/json'}, method='POST')
    with urlopen(request, timeout=12) as response:
        receipt = json.loads(response.read(8000))
    if receipt.get('code') != 200:
        raise RuntimeError('Bark did not confirm delivery')
    return receipt


def refresh_profile(db, token):
    try:
        profile = load_profile(token)
        with closing(db()) as con, con:
            return set_profile(con, profile, token)
    except Exception:
        with closing(db()) as con:
            return settings(con)


def enqueue(con, ident, room, body, completed):
    config = settings(con)
    if not config['enabled'] or completed < config['since']:
        return
    # Mark viewed turns permanently suppressed, even if the user leaves a moment later.
    status = 'viewed' if watching(con, room, completed) else 'pending'
    con.execute('INSERT OR IGNORE INTO bark_events(id,room,body,completed,status) VALUES(?,?,?,?,?)', (ident, room, body[:1600], completed, status))


def completed_time(event):
    timestamp = event.get('timestamp', '')
    try:
        return datetime.fromisoformat(timestamp.replace('Z', '+00:00')).timestamp()
    except (ValueError, AttributeError):
        return None


def scan_thread(con, room, thread, path, since):
    path = Path(path)
    if not path.is_file():
        return
    stat = path.stat()
    previous = con.execute('SELECT * FROM bark_cursors WHERE thread=?', (thread,)).fetchone()
    initial = not previous or previous['path'] != str(path) or previous['inode'] != stat.st_ino or previous['offset'] > stat.st_size
    offset = max(0, stat.st_size - 2_000_000) if initial else previous['offset']
    with path.open('rb') as stream:
        stream.seek(offset)
        if initial and offset: stream.readline(); offset = stream.tell()
        # Incremental reads; a long historic rollout cannot monopolize the poller.
        limit = offset + 2_000_000
        while stream.tell() < limit:
            raw = stream.readline()
            if not raw or not raw.endswith(b'\n'): break
            offset = stream.tell()
            try:
                event = json.loads(raw); payload = event.get('payload', {})
                at = completed_time(event)
                if event.get('type') != 'event_msg' or payload.get('type') != 'task_complete' or at is None or at < since:
                    continue
                turn = payload.get('turn_id')
                if isinstance(turn, str) and turn:
                    enqueue(con, 'turn:' + thread + ':' + turn, room, str(payload.get('last_agent_message') or ''), at)
            except (ValueError, TypeError, AttributeError): pass
    con.execute('INSERT INTO bark_cursors VALUES(?,?,?,?) ON CONFLICT(thread) DO UPDATE SET path=excluded.path,inode=excluded.inode,offset=excluded.offset', (thread, str(path), stat.st_ino, offset))


def scan(db):
    import vesper_conversation_delete as deletion
    with closing(db()) as con, con:
        config = settings(con)
        if not config['enabled']: return
        rooms = con.execute('SELECT vesper_conversation_id,codex_thread_id FROM conversations WHERE archived_at IS NULL AND codex_thread_id IS NOT NULL').fetchall()
        lookup = {r['codex_thread_id']: r['vesper_conversation_id'] for r in rooms if not deletion.is_deleted(con, r['vesper_conversation_id'], r['codex_thread_id'])}
        home = deletion.CODEX_HOME.resolve()
        if (home / 'state_5.sqlite').is_file():
            with closing(sqlite3.connect('file:' + str(home / 'state_5.sqlite') + '?mode=ro', uri=True)) as sources:
                for thread, raw_path in sources.execute('SELECT id,rollout_path FROM threads'):
                    if thread not in lookup: continue
                    path = Path(raw_path).resolve()
                    if any(path.is_relative_to(home / folder) for folder in ('sessions', 'archived_sessions')):
                        scan_thread(con, lookup[thread], thread, path, config['since'])
        # Independent wake/poke workers already store one final message after successful completion.
        since = datetime.fromtimestamp(config['since'], timezone.utc).isoformat().replace('+00:00', 'Z')
        rows = con.execute("SELECT m.* FROM messages m JOIN conversations c ON c.vesper_conversation_id=m.vesper_conversation_id WHERE c.archived_at IS NULL AND m.role='agent' AND m.status='delivered' AND m.created_at>=? AND (m.id LIKE 'wake:%:final' OR m.id LIKE 'poke:%:reply')", (since,)).fetchall()
        for row in rows:
            meta = json.loads(row['metadata_json'])
            key = 'wake:' + str(meta['wakeRunId']) if meta.get('wakeRunId') else 'poke:' + str(meta['companionPokeId']) if meta.get('companionPokeId') else ''
            at = completed_time({'timestamp': row['created_at']})
            if key and at: enqueue(con, key, row['vesper_conversation_id'], row['content'], at)


def deliver_pending(db, token, sender=None):
    import vesper_codex_records as records
    with closing(db()) as con:
        config = settings(con)
        jobs = con.execute("SELECT * FROM bark_events WHERE status='pending' ORDER BY completed LIMIT 20").fetchall() if config['enabled'] else []
    if not jobs: return
    config = refresh_profile(db, token) if sender is None else config
    for job in jobs:
        with closing(db()) as con, con:
            current = settings(con)
            room = con.execute('SELECT archived_at FROM conversations WHERE vesper_conversation_id=?', (job['room'],)).fetchone()
            if not current['enabled'] or not room or room['archived_at'] or job['completed'] < current['since']:
                con.execute("UPDATE bark_events SET status='cancelled' WHERE id=?", (job['id'],)); continue
            if watching(con, job['room'], time.time()):
                con.execute("UPDATE bark_events SET status='viewed' WHERE id=?", (job['id'],)); continue
        if job['id'].startswith('turn:'):
            with closing(db()) as con, con:
                records.sync(con, job['room'])
        with closing(db()) as con, con:
            body = job['body']
            if job['id'].startswith('turn:'):
                turn = job['id'].split(':', 2)[2]
                rows = con.execute("SELECT content,metadata_json FROM messages WHERE vesper_conversation_id=? AND role='agent' AND status='delivered' AND (turn_id=? OR json_extract(metadata_json,'$.turnId')=?) ORDER BY created_at,rowid", (job['room'], turn, turn)).fetchall()
                texts = []
                for row in rows:
                    meta = json.loads(row['metadata_json'])
                    if meta.get('phase') == 'commentary' or meta.get('blockType', '') not in ('', 'agentMessage', 'assistantMessage', 'text', 'message'): continue
                    if row['content'].strip(): texts.append(row['content'].strip())
                    elif meta.get('attachments'): texts.append('发来了附件')
                if texts: body = '\n'.join(dict.fromkeys(texts))
            body = body.strip() or '有一条新回复'
            claimed = con.execute("UPDATE bark_events SET status='sending' WHERE id=? AND status='pending'", (job['id'],)).rowcount
            if not claimed: continue
        try:
            send(config, body, job['room'], sender)
            status, error = 'sent', None
        except Exception:
            # A lost receipt may already have delivered. Never blindly duplicate a notification.
            status, error = 'uncertain', 'Bark delivery could not be confirmed'
        with closing(db()) as con, con:
            con.execute('UPDATE bark_events SET status=?,error=? WHERE id=?', (status, error, job['id']))


def start(db, token_reader):
    global _started
    with _lock:
        if _started: return
        _started = True
    with closing(db()) as con, con:
        settings(con)
        con.execute("UPDATE bark_events SET status='uncertain',error='Service restarted during delivery' WHERE status='sending'")
    def run():
        while True:
            try: scan(db); deliver_pending(db, token_reader())
            except Exception: pass  # Never crash chat storage or log notification content/credentials.
            time.sleep(2)
    threading.Thread(target=run, name='vesper-bark', daemon=True).start()
