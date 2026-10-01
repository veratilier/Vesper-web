"""Local wall-clock sleep windows. No network activity or model calls."""
from datetime import datetime, timedelta
import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT = {'enabled': True, 'start': '00:00', 'end': '07:00', 'timeZone': 'Asia/Shanghai', 'dreamEnabled': True}

def validate(value):
    if not isinstance(value, dict) or set(value) != set(DEFAULT):
        raise ValueError('Expected enabled, start, end, timeZone and dreamEnabled sleep settings')
    if type(value['enabled']) is not bool or type(value['dreamEnabled']) is not bool:
        raise ValueError('Sleep switches must be boolean')
    for key in ('start', 'end'):
        if not isinstance(value[key], str) or not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', value[key]):
            raise ValueError('Sleep time must use HH:mm')
    if value['start'] == value['end']:raise ValueError('Sleep start and end must differ')
    try:ZoneInfo(value['timeZone'])
    except (ZoneInfoNotFoundError, TypeError, ValueError):raise ValueError('Unknown sleep time zone')
    return dict(value)

def window(config, now):
    config = validate(config)
    if not config['enabled']:return None
    local = datetime.fromtimestamp(now, ZoneInfo(config['timeZone']))
    sh, sm = map(int, config['start'].split(':')); eh, em = map(int, config['end'].split(':'))
    start = local.replace(hour=sh, minute=sm, second=0, microsecond=0)
    end = local.replace(hour=eh, minute=em, second=0, microsecond=0)
    if end <= start:
        if local < end:start -= timedelta(days=1)
        else:end += timedelta(days=1)
    if start.timestamp() <= now < end.timestamp():
        return {'id': config['timeZone'] + ':' + start.isoformat(), 'start': start.timestamp(), 'end': end.timestamp()}
    return None
