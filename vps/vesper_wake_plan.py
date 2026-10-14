"""Bounded, durable agent wake plans. Does not change owner settings or permissions."""
import math
from datetime import datetime, timezone

import vesper_wake_sleep as sleep

MIN_SECONDS = 30 * 60
MAX_SECONDS = 24 * 60 * 60
TASK_LIMIT = 1000
REASON_LIMIT = 200
SELF_PROMPT_LIMIT = 2000


def fields():
    return {
        'nextWake': {
            'type': 'object',
            'properties': {
                'at': {'type': 'string', 'minLength': 1, 'maxLength': 64},
                'task': {'type': 'string', 'minLength': 1, 'maxLength': TASK_LIMIT},
                'reason': {'type': 'string', 'minLength': 1, 'maxLength': REASON_LIMIT},
            },
            'required': ['at', 'task', 'reason'],
            'additionalProperties': False,
        },
        'selfPrompt': {'anyOf': [
            {'type': 'string', 'minLength': 1, 'maxLength': SELF_PROMPT_LIMIT},
            {'type': 'null'},
        ]},
    }


def outside_sleep(at, setting):
    quiet = sleep.window(setting, at)
    return quiet['end'] if quiet else at


def validate(value, now, setting, started_at=None):
    if not isinstance(value, dict) or set(value) != {'at', 'task', 'reason'}:
        raise ValueError('nextWake requires at, task and reason')
    for field, limit in [('at', 64), ('task', TASK_LIMIT), ('reason', REASON_LIMIT)]:
        if not isinstance(value[field], str) or not value[field].strip() or len(value[field]) > limit:
            raise ValueError('Invalid nextWake ' + field)
    try:
        parsed = datetime.fromisoformat(value['at'].replace('Z', '+00:00'))
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise ValueError('Missing timezone')
        requested = parsed.timestamp()
    except (ValueError, OverflowError):
        raise ValueError('nextWake.at must be ISO 8601 with timezone') from None
    reference = now if started_at is None else started_at
    if not math.isfinite(requested) or not reference + MIN_SECONDS <= requested <= reference + MAX_SECONDS or requested <= now:
        raise ValueError('nextWake must be 30 minutes to 24 hours after the planning turn starts and still in the future')
    # Model/tool execution takes time. Keep a full minimum interval after saving.
    earliest = max(requested, now + MIN_SECONDS)
    at = outside_sleep(earliest, setting)
    return {
        'version': 2, 'mode': 'agent', 'drawnAt': now,
        'seconds': round(at - now), 'nextAt': at,
        'at': datetime.fromtimestamp(at, timezone.utc).isoformat(),
        'requestedAt': requested, 'requestedTime': parsed.isoformat(),
        'sleepAdjusted': at != earliest, 'executionAdjusted': earliest != requested,
        'task': value['task'].strip(), 'reason': value['reason'].strip(),
    }


def validate_self_prompt(value):
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > SELF_PROMPT_LIMIT:
        raise ValueError('selfPrompt must be null or contain 1 to 2000 characters')
    return value.strip()


def postpone(schedule, earliest, setting, now, reason):
    """Keep the chosen task when a host gate delays execution."""
    result = dict(schedule)
    at = outside_sleep(max(float(result['nextAt']), earliest), setting)
    result.update(nextAt=at, at=datetime.fromtimestamp(at, timezone.utc).isoformat(),
                  seconds=round(at - now), deferredAt=now, deferredReason=reason)
    return result
