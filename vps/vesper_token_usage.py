"""Provider-reported counters only; absent cache counts stay unknown."""
import json

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
