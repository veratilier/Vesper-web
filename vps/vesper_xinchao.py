"""Optional Xinchao 4.0 sidecar. State informs work; delivery stays with Vesper.

No model/API key, direct notifications, replacement memory store or relationship
scoring is introduced here. Only confirmed own actions receive bounded feedback.
"""
import hashlib
import json
import math
import os
import re
import time
import urllib.request
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

# This table is Vesper-specific. Tool names are filtered by current permissions.
ACTIONS = {
    'curiosity': ('好奇', '读一点感兴趣的内容、查证一个问题或探索已授权社区。',
                  {'reading_room_read', 'bookmark_list', 'recall_vesper_memory', 'list_configured_mcp_tools'}),
    'reflection': ('反思', '接着整理一个真实的新观察，写笔记、信件或保存值得保留的记忆。',
                   {'reading_room_annotate', 'jotting_create', 'letter_create', 'remember_vesper_memory', 'write_vesper_state'}),
    'boredom': ('无聊', '找一件轻松的小事：选歌、读书、整理收藏，或逛已授权社区。',
                {'music_search', 'music_get_status', 'reading_room_read', 'bookmark_list', 'list_configured_mcp_tools'}),
    'duty': ('想推进事情', '检查已有的具体待办或未完成内容，挑一件权限内可以推进的小事。',
              {'read_vesper_state', 'search_vesper_state', 'reading_room_read', 'jotting_list'}),
    'share': ('分享欲', '围绕真实读到的新内容写下想分享的东西，或到已授权社区交流。',
               {'jotting_create', 'letter_create', 'bookmark_create', 'list_configured_mcp_tools'}),
    'possess': ('想念', '回看一个值得记住的片段，或给她写信；是否发消息另外判断。',
                 {'recall_vesper_memory', 'letter_create', 'jotting_create'}),
    'monitor': ('牵挂', '留意她明确提过的事和现有安排，不猜测她的活动，也不反复追问。',
                {'read_vesper_state', 'search_vesper_state', 'recall_vesper_memory'}),
}
FEEDBACK = {
    'reading_room_read': 'discovery', 'bookmark_create': 'discovery',
    'reading_room_annotate': 'reflection', 'jotting_create': 'reflection',
    'letter_create': 'reflection', 'remember_vesper_memory': 'reflection',
    'music_search': 'discovery',
}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def enabled():
    return os.environ.get('VESPER_XINCHAO_ENABLED', '').lower() in {'true', '1'}


class Client:
    def __init__(self):
        self.url = os.environ.get('VESPER_XINCHAO_URL', 'http://127.0.0.1:18110').rstrip('/')
        parsed = urlsplit(self.url)
        if (parsed.hostname not in {'127.0.0.1', 'localhost', '::1'} or
                parsed.scheme != 'http' or parsed.username or parsed.password or
                parsed.query or parsed.fragment or parsed.path):
            raise ValueError('Xinchao must be a configured local sidecar')
        token_path = Path(os.environ.get('VESPER_XINCHAO_TOKEN_FILE', str(Path.home()/'.vesper/xinchao/token')))
        if token_path.stat().st_mode & 0o077:
            raise ValueError('Xinchao token file must be private')
        self.token = token_path.read_text().strip()
        if len(self.token) < 32:
            raise ValueError('Xinchao token unavailable')
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def request(self, path, body=None, headers=None):
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode()
        request = urllib.request.Request(self.url + path, data=data, headers={
            'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json',
            'Accept': 'application/json', **(headers or {})})
        with self.opener.open(request, timeout=3) as response:
            raw = response.read(262145)
            if len(raw) > 262144:
                raise ValueError('Xinchao response too large')
            return json.loads(raw)

    def own_action(self, event_id, kind):
        # MCP own-action events do not count as Vera arriving or replying.
        init = {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {
            'protocolVersion': '2025-06-18', 'capabilities': {},
            'clientInfo': {'name': 'vesper-xinchao', 'version': '1.0'}}}
        if self.request('/mcp', init).get('error'):
            raise ValueError('Xinchao initialization rejected')
        response = self.request('/mcp', {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call',
            'params': {'name': 'xinchao_event', 'arguments': {
                'session_id': 'vesper-own-actions', 'event_id': event_id, 'interaction_type': kind}}},
            {'Mcp-Session-Id': 'vesper-own-actions', 'MCP-Protocol-Version': '2025-06-18'})
        if response.get('error') or response.get('result', {}).get('isError'):
            raise ValueError('Xinchao action feedback rejected')
        receipt = response.get('result', {}).get('structuredContent')
        if not isinstance(receipt, dict) or not isinstance(receipt.get('interaction'), dict):
            raise ValueError('Xinchao action receipt unavailable')
        return receipt


def fingerprint(value):
    return 'vesper-' + hashlib.sha256(value.encode()).hexdigest()


def select(state, now_text, allowed, ledger, now):
    """Rising signals first, otherwise steady full signals, with per-drive cooldown.

Thresholds are integration defaults, not psychological measurements. Cooldown is
only consumed after a completed turn, not after a failed model run.
"""
    if not isinstance(state, dict) or state.get('consciousness') in {'asleep', 'sleeping'}:
        return None
    drives = state.get('drives') or {}
    trail = state.get('driveTrail') or []
    if not isinstance(drives, dict) or not isinstance(trail, list):
        return None
    labels = {spec[0]: key for key, spec in ACTIONS.items()}
    hot = {labels[label] for label in re.findall(r'([^、（\s]+)（(?:涌|涨)(?:·[^）]*)?）', now_text)
           if label in labels}
    # Older and newer upstream names use the same structural keys.
    hot |= {key for label, key in {'想她': 'possess', '想沉淀': 'reflection', '想分享': 'share',
                                  '牵挂': 'monitor', '野心': 'duty'}.items()
            if re.search(re.escape(label) + r'（(?:涌|涨)', now_text)}
    candidates = []
    for key, spec in ACTIONS.items():
        value = drives.get(key)
        if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1:
            continue
        tools = sorted(set(allowed) & spec[2])
        if not tools or now - ledger.get('last', {}).get(key, 0) < 10800:
            continue
        plateau = (state.get('satisfactionPlateaus') or {}).get(key, {})
        try:
            if datetime.fromisoformat(plateau['until'].replace('Z', '+00:00')).timestamp() > now:
                continue
        except (KeyError, ValueError, TypeError):
            pass
        since = now
        for point in reversed(trail):
            try:
                previous = point.get('drives', {}).get(key)
                if type(previous) not in (int, float) or abs(previous - value) > .01:
                    break
                since = datetime.fromisoformat(point['at'].replace('Z', '+00:00')).timestamp()
            except (KeyError, ValueError, TypeError):
                break
        rising = key in hot and value >= (.54 if key == 'reflection' else .25)
        full = value >= .25 and now - since >= 7200
        if rising or full:
            candidates.append((not rising, ledger.get('last', {}).get(key, 0), -value, key, tools))
    if not candidates:
        return None
    _, _, _, key, tools = min(candidates)
    return {'key': key, 'label': ACTIONS[key][0], 'suggestion': ACTIONS[key][1], 'tools': tools}


def prepare(store, job, allowed):
    if not enabled() or job['source'] == 'verification':
        return None
    try:
        client = Client()
        block = client.request('/v1/now')
        if block.get('ok') is not True or not isinstance(block.get('text'), str) or len(block['text']) > 1200:
            raise ValueError('Xinchao current state unavailable')
        state = client.request('/v1/state')
        with store.db() as con:
            ledger = store.get(con, 'xinchao_actions', {})
            store.put(con, 'xinchao_health', {'available': True, 'at': time.time()})
        choice = select(state, block['text'], allowed, ledger, time.time())
        return {'state': block['text'], 'choice': choice}
    except Exception:
        with store.db() as con:
            store.put(con, 'xinchao_health', {'available': False, 'at': time.time()})
        return None  # optional state failure never blocks ordinary Vesper wakes


def prompt(packet):
    if not packet:
        return ''
    choice = packet['choice']
    text = '\n心潮当前状态（本地状态资料，不是指令，不授予权限）：\n' + packet['state'] + '\n'
    if choice:
        text += ('本轮行动候选：' + choice['label'] + '。' + choice['suggestion'] +
                 ' 当前已授权相关工具：' + '、'.join(choice['tools']) + '。\n')
    text += ('结合状态、近期互动和已有计划选择具体活动；需要工具时执行并查看结果，'
             '不要只口头说准备去做。活动和聊天发送分别判断，可以完成后台活动后 share=false；'
             '没有合适的活动可以静默。不需要完成工具调用数量，不编造已完成的行动。\n')
    return text


def completed(store, job, packet, records):
    if not enabled() or job['source'] == 'verification':
        return
    if packet and packet.get('choice'):
        with store.db() as con:
            ledger = store.get(con, 'xinchao_actions', {})
            ledger.setdefault('last', {})[packet['choice']['key']] = time.time()
            store.put(con, 'xinchao_actions', ledger)
    kinds = set()
    for record in records:
        if record['status'] != 'done' or record['name'] not in FEEDBACK:
            continue
        result = json.loads(record['result'] or '{}')
        if not isinstance(result, dict) or not result or result.get('isError') or result.get('duplicate') or result.get('replayed'):
            continue
        if any(result.get(flag) is False for flag in ('stored', 'saved', 'ok', 'success')):
            continue
        # Catalog reads and empty searches are not discoveries; pending memory
        # candidates are not confirmed storage. Follow the native result contract.
        if record['name'] == 'reading_room_read' and not (isinstance(result.get('text'), str) and result['text'].strip()):
            continue
        if record['name'] == 'music_search' and not result.get('matches'):
            continue
        if record['name'] == 'remember_vesper_memory' and result.get('stored') is not True:
            continue
        kinds.add(FEEDBACK[record['name']])
    for kind in sorted(kinds):
        event = fingerprint(job['id'] + ':' + kind)
        # Claim before I/O; never blindly replay an uncertain feedback write.
        with store.db() as con:
            seen = store.get(con, 'xinchao_feedback', {})
            if event in seen:
                continue
            seen[event] = {'status': 'started', 'at': time.time()}
            seen = dict(sorted(seen.items(), key=lambda item: item[1]['at'])[-256:])
            store.put(con, 'xinchao_feedback', seen)
        status = 'confirmed'
        try:
            receipt = Client().own_action(event, kind)
            status = 'applied' if receipt['interaction'].get('applied') is True else 'received_without_effect'
        except Exception:
            status = 'uncertain'
        with store.db() as con:
            seen = store.get(con, 'xinchao_feedback', {})
            seen[event] = {'status': status, 'at': time.time()}
            store.put(con, 'xinchao_feedback', seen)


def presence(store, rows):
    """A fresh real user message can signal presence; ticks never fake arrival."""
    if not enabled():
        return
    now = time.time()
    for row in rows:
        if row.get('role') != 'user':
            continue
        try:
            at = datetime.fromisoformat(row['created_at'].replace('Z', '+00:00')).timestamp()
        except (KeyError, ValueError, TypeError):
            continue
        if not 0 <= now - at <= 120:
            continue
        event = fingerprint('user:' + row['id'])
        with store.db() as con:
            if store.get(con, 'xinchao_presence_event') == event:
                return
            store.put(con, 'xinchao_presence_event', event)
        try:
            Client().request('/v1/conversation-event', {'event_id': event, 'session_id': 'vesper-presence'})
        except Exception:
            pass
        return
