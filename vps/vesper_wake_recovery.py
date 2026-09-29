"""Persistent recovery policy. Contains metadata only, never prompts or tool arguments."""
import hashlib, json

FAILURES = {'failed', 'interrupted'}
SUCCESS = {'completed', 'saved', 'push_failed'}


def kind(error):
    text = str(error).lower()
    if any(s in text for s in ('429', 'usage limit', 'rate limit', 'quota', 'usage_limit', 'usagelimit')):
        return 'quota'
    if any(s in text for s in ('401', 'unauthorized', 'login', 'authentication', 'not authenticated')):
        return 'authentication'
    return 'consecutive_failures'


def failure(state, event, now, reason='consecutive_failures'):
    state = dict(state or {})
    if state.get('lastEvent') == event:return state
    count = state.get('failureCount', 0) + 1
    delay = min(14400, 1800 * 2 ** min(3, max(0, count - 3))) if count >= 3 else 0
    if reason in {'quota', 'authentication'}:delay = 1800
    return {'failureCount': count, 'lastEvent': event, 'reason': reason,
            'retryAt': now + delay if delay else None, 'lastFailureAt': now}


def success(state, event):
    return {'failureCount': 0, 'lastEvent': event, 'reason': None, 'retryAt': None}


def blocked(state, now):
    return bool((state or {}).get('retryAt', 0) and state['retryAt'] > now)


def tool_key(name, args):
    if name == 'call_configured_mcp_tool':
        return 'mcp:' + str(args.get('connectionId', '')) + ':' + str(args.get('toolName', ''))
    return name


def fingerprint(key, args):
    return hashlib.sha256((key + json.dumps(args, sort_keys=True, separators=(',', ':'))).encode()).hexdigest()


def quota_reset(result, now):
    limits = result.get('rateLimitsByLimitId') or {'default': result.get('rateLimits') or {}}
    resets = []
    for limit in limits.values():
        if not isinstance(limit, dict):continue
        for window in (limit.get('primary'), limit.get('secondary')):
            if isinstance(window, dict) and window.get('usedPercent', 0) >= 100:
                resets.append(window.get('resetsAt') or now + 1800)
    return max(resets) if resets else None
