"""Provider-reported counters only; absent cache counts stay unknown."""
import json
from collections import OrderedDict

FIELDS = {
    'inputTokens': 'input_tokens', 'cachedInputTokens': 'cached_input_tokens',
    'cacheWriteInputTokens': 'cache_write_input_tokens', 'outputTokens': 'output_tokens',
    'reasoningOutputTokens': 'reasoning_output_tokens', 'totalTokens': 'total_tokens',
}


def snapshot(value, complete=False):
    if not isinstance(value, dict): return None
    counts = {}
    for field, legacy in FIELDS.items():
        number = value.get(field, value.get(legacy))
        if number is None: continue
        if type(number) is not int or not 0 <= number <= 2**53 - 1: return None
        counts[field] = number
    if not all(field in counts for field in ('inputTokens', 'outputTokens', 'totalTokens')): return None
    if counts.get('cachedInputTokens', 0) > counts['inputTokens']: return None
    if counts.get('reasoningOutputTokens', 0) > counts['outputTokens']: return None
    return dict(counts, scope='turn', complete=complete)


def stored(raw, complete=False):
    try: return snapshot(json.loads(raw), complete=complete) if raw else None
    except (ValueError, TypeError): return None


def difference(current, previous):
    if current is None or previous is None: return None
    result = {}
    for field in FIELDS:
        if field not in current or field not in previous: continue
        if current[field] < previous[field]: return None
        result[field] = current[field] - previous[field]
    return snapshot(result)


class RolloutUsage:
    """Incremental per-turn accounting from the existing rollout, without prompt text."""
    def __init__(self):
        self.total = None
        self.baseline = None
        self.active = None
        self.complete = False
        self.turns = OrderedDict()

    def observe(self, payload):
        kind = payload.get('type')
        if kind == 'task_started':
            self.active = payload.get('turn_id')
            self.baseline = self.total
            self.complete = False
        elif kind == 'token_count':
            info = payload.get('info') or {}
            total = snapshot(info.get('total_token_usage'))
            if total is None: return
            if self.active:
                if self.baseline is None:
                    self.baseline = difference(total, snapshot(info.get('last_token_usage')))
                counts = difference(total, self.baseline)
                if counts is not None:
                    self.turns[self.active] = dict(counts, complete=self.complete)
                    while len(self.turns) > 2048: self.turns.popitem(last=False)
            self.total = total
        elif kind == 'task_complete' and payload.get('turn_id') == self.active:
            self.complete = True
            if self.active in self.turns: self.turns[self.active]['complete'] = True
