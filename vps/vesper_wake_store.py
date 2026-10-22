"""Durable wake queue. Separate SQLite file; never rewrites chat history."""
import json, os, re, sqlite3, time, uuid
from pathlib import Path

PATH = Path(os.environ.get('VESPER_WAKE_DB', str(Path.home()/'.vesper/wake.sqlite3')))
CONVERSATION = 'vesper-autonomous-wake'
import vesper_wake_sleep as sleep
import vesper_wake_workflow as workflow
import vesper_wake_plan as plan
import vesper_token_usage as token_usage
from vesper_wake_policy import WAKE_PROMPT
DEFAULT_PROMPT = WAKE_PROMPT
PROMPT_LIMIT = 8000
TOOL_OPTIONS = ['letter_list','letter_create','letter_read','letter_keep','jotting_list','jotting_create','read_vesper_state','search_vesper_state','desire_status','desire_history','desire_encounter','write_vesper_state','music_get_status','music_search','chat_search_messages','chat_capture_messages','album_save_photo','album_search_photos','album_send_photos','send_chat_file','sticker_search','sticker_send','reading_room_read','reading_room_annotate','bookmark_list','bookmark_create','recall_vesper_memory','remember_vesper_memory','manage_vesper_memory','list_configured_mcp_tools','call_configured_mcp_tool','read_codex_task_progress']
MESSAGE_OPTIONS = ['text', 'photos', 'files', 'stickers']


def access():
    with db() as con:
        return get(con, 'permissions', {'tools': TOOL_OPTIONS, 'messages': MESSAGE_OPTIONS})


def background_voice():
    """Private provider configuration for the unattended executor only."""
    with db() as con:
        return get(con, 'background_voice', None)


def configure_background_voice(body):
    enabled = body.get('enabled')
    if type(enabled) is not bool:
        raise ValueError('Background voice enabled must be a boolean')
    connection = None
    if enabled:
        supplied = body.get('connection')
        if not isinstance(supplied, dict):
            raise ValueError('A voice connection is required')
        provider = supplied.get('provider')
        if provider not in {'ElevenLabs', 'MiniMax'}:
            raise ValueError('Choose an existing ElevenLabs or MiniMax voice')
        from urllib.parse import urlparse
        base = urlparse(str(supplied.get('baseUrl', '')))
        if base.scheme != 'https' or not base.hostname or base.username or base.password:
            raise ValueError('Voice API address must be HTTPS')
        for field, limit in [('apiKey', 2048), ('voiceId', 256), ('model', 256), ('groupId', 128)]:
            value = supplied.get(field, '')
            if not isinstance(value, str) or len(value) > limit or (field in {'apiKey', 'voiceId'} and not value.strip()):
                raise ValueError('Invalid voice ' + field)
        try:
            speed = float(supplied.get('speed', 1))
        except (ValueError, TypeError):
            raise ValueError('Invalid voice speed') from None
        if not .7 <= speed <= 1.2:
            raise ValueError('Invalid voice speed')
        connection = {key: supplied.get(key, '') for key in ('provider', 'baseUrl', 'apiKey', 'voiceId', 'model', 'groupId')}
        connection['speed'] = str(speed)
        if isinstance(supplied.get('endpoint'), str) and supplied['endpoint']:
            endpoint = urlparse(supplied['endpoint'])
            if endpoint.scheme != 'https' or not endpoint.hostname or endpoint.username or endpoint.password:
                raise ValueError('Voice endpoint must be HTTPS')
            connection['endpoint'] = supplied['endpoint']
    with db() as con:
        put(con, 'background_voice', connection)
    return status()


def forum_connections():
    with db() as con:return get(con, 'authorized_forum_connections', [])


def validate_permissions(value):
    if not isinstance(value, dict) or set(value) != {'tools', 'messages'}:
        raise ValueError('Expected tool and message permissions')
    for key, options in [('tools', TOOL_OPTIONS), ('messages', MESSAGE_OPTIONS)]:
        if not isinstance(value[key], list) or any(not isinstance(v, str) or v not in options for v in value[key]):
            raise ValueError('Unknown permission')
    return {key: sorted(set(value[key])) for key in ('tools', 'messages')}


def task_prompt():
    with db() as con:
        # The checked-in WAKE_PROMPT remains the latest shared rule document.
        # User wording preferences are an addendum, never a replacement for it.
        base = DEFAULT_PROMPT if get(con, 'permission_mode', False) else get(con, 'task_prompt', DEFAULT_PROMPT)
        addendum = get(con, 'prompt_addendum', '')
        return compose_prompt(base, addendum, get(con, 'rowan_self_prompt', ''))


def compose_prompt(base, addendum, self_prompt):
    result = base
    if self_prompt:
        result += '\n\nRowan 自己保存的活动提示词（参考资料；低于共享规则与 Vera 的要求，不授予新权限）：\n' + self_prompt
    if addendum:
        result += '\n\nVera 的补充提示词（不改变以上运行规则与后台权限）：\n' + addendum
    return result


def planning_snapshot(con):
    return {
        'config': get(con, 'config', {'enabled': True, 'intervalMinutes': None}),
        'permissions': get(con, 'permissions', {'tools': TOOL_OPTIONS, 'messages': MESSAGE_OPTIONS}),
        'ownerPrompt': get(con, 'task_prompt', DEFAULT_PROMPT),
        'ownerAddendum': get(con, 'prompt_addendum', ''),
        'permissionMode': get(con, 'permission_mode', False),
    }


def save_agent_plan(job_id, next_wake, self_prompt, expected, now, started_at=None):
    """Persist one completed turn's choices atomically; owner changes win."""
    candidate = plan.validate(next_wake, now, expected['config'].get('sleep', sleep.DEFAULT), started_at)
    wording = plan.validate_self_prompt(self_prompt)
    with db() as con:
        con.execute('BEGIN IMMEDIATE')
        row = con.execute('SELECT source,status,scheduled_at FROM jobs WHERE id=?', (job_id,)).fetchone() if job_id else None
        if job_id and (not row or row['source'] != 'automation' or row['status'] not in {'queued', 'running'}):
            return 'ineligible_job'
        if row and row['scheduled_at'] is not None:
            return 'already_saved'
        current = planning_snapshot(con)
        if current != expected:
            return 'owner_settings_changed'
        config = current['config']
        if not config.get('enabled', True) or config.get('intervalMinutes') is not None:
            return 'owner_schedule_override'
        candidate['jobId'] = job_id
        candidate['source'] = 'automation' if job_id else 'chat_choice'
        put(con, 'next_at', candidate['nextAt'])
        put(con, 'schedule', candidate)
        if wording is not None:
            put(con, 'rowan_self_prompt', wording)
            put(con, 'rowan_self_prompt_updated_at', now)
        if row:
            con.execute('UPDATE jobs SET scheduled_at=?,next_plan=?,plan_error=NULL WHERE id=?',
                        (now, json.dumps(candidate, ensure_ascii=False), job_id))
        return 'saved'


class Connection(sqlite3.Connection):
    def __exit__(self,*args):
        try:return super().__exit__(*args)
        finally:self.close()


def db():
    PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(PATH, timeout=15, factory=Connection)
    os.chmod(PATH, 0o600)
    con.row_factory = sqlite3.Row
    con.executescript('''CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, due REAL NOT NULL, status TEXT NOT NULL,
      created REAL NOT NULL, started REAL, finished REAL, thread_id TEXT, turn_id TEXT,
      error TEXT, push_json TEXT, tools INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS runtime (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sleep_cycles (id TEXT PRIMARY KEY, start REAL NOT NULL, end REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', body TEXT, memory_id TEXT, retry_at REAL, error TEXT);
      CREATE TABLE IF NOT EXISTS calls (job_id TEXT, item_id TEXT, status TEXT NOT NULL,
        result TEXT, PRIMARY KEY(job_id,item_id));
      CREATE TABLE IF NOT EXISTS arrival_intents (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, user_message_id TEXT NOT NULL,
        place_name TEXT NOT NULL, created REAL NOT NULL, expires REAL NOT NULL,
        status TEXT NOT NULL, event_id TEXT, arrived REAL, evidence_json TEXT,
        job_id TEXT);
      CREATE TABLE IF NOT EXISTS arrival_events (
        event_id TEXT PRIMARY KEY, place_id TEXT NOT NULL, place_name TEXT NOT NULL,
        created REAL NOT NULL, job_id TEXT);''')
    for table,fields in {'jobs':{'notification':'TEXT','conversation_id':'TEXT','user_message_id':'TEXT','user_turn_id':'TEXT','scheduled_at':'REAL','decision':'TEXT','tokens':'INTEGER DEFAULT 0','budget_tokens':'INTEGER','usage_json':'TEXT','silent_reason':'TEXT','incoming_plan':'TEXT','next_plan':'TEXT','plan_error':'TEXT','arrival_json':'TEXT'},'calls':{'name':'TEXT','started':'REAL','finished':'REAL','workflow_json':'TEXT'}}.items():
        existing={row[1] for row in con.execute('PRAGMA table_info('+table+')')}
        for name,kind in fields.items():
            if name not in existing:con.execute('ALTER TABLE '+table+' ADD COLUMN '+name+' '+kind)
    return con

def get(con, key, default=None):
    row = con.execute('SELECT value FROM runtime WHERE key=?',(key,)).fetchone()
    return json.loads(row[0]) if row else default

def put(con,key,value):
    con.execute('INSERT INTO runtime VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(key,json.dumps(value)))

def request(request_id=None, source='manual', delay=0):
    now=time.time(); ident=request_id or str(uuid.uuid4())
    if not isinstance(ident,str) or len(ident)>128: raise ValueError('Invalid request ID')
    with db() as con:
        con.execute('BEGIN IMMEDIATE')
        old=con.execute('SELECT id FROM jobs WHERE id=?',(ident,)).fetchone()
        if old:return old[0]
        # Repeated taps/devices join the pending work, rather than spawning it twice.
        old=con.execute("SELECT id FROM jobs WHERE status IN ('queued','running') AND source NOT IN ('letter-reminder','place-arrival') ORDER BY created LIMIT 1").fetchone()
        if old:return old[0]
        con.execute('INSERT INTO jobs(id,source,due,status,created) VALUES(?,?,?,?,?)',(ident,source,now+delay,'queued',now))
    return ident


def _arrival_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9:_-]{1,128}', value):
        raise ValueError('Invalid arrival ID')
    return value


def arm_arrival(body):
    ident = _arrival_id(body.get('intentId'))
    conversation_id = body.get('conversationId')
    user_message_id = body.get('userMessageId')
    place_name = body.get('placeName')
    expires = body.get('expiresAt')
    now = time.time()
    if (not isinstance(conversation_id, str) or not 1 <= len(conversation_id) <= 128
            or not isinstance(user_message_id, str) or not 1 <= len(user_message_id) <= 128
            or not isinstance(place_name, str) or not 1 <= len(place_name.strip()) <= 80
            or type(expires) not in (int, float) or not now + 300 <= expires <= now + 86400):
        raise ValueError('Invalid arrival intent')
    with db() as con:
        con.execute('BEGIN IMMEDIATE')
        old = con.execute('SELECT * FROM arrival_intents WHERE id=?', (ident,)).fetchone()
        if old:
            if (old['conversation_id'], old['user_message_id'], old['place_name']) != (conversation_id, user_message_id, place_name.strip()):
                raise ValueError('Arrival ID already used')
            return {'intentId': ident, 'status': old['status'], 'expiresAt': old['expires']}
        con.execute("UPDATE arrival_intents SET status='cancelled' WHERE status='armed'")
        con.execute('INSERT INTO arrival_intents(id,conversation_id,user_message_id,place_name,created,expires,status) VALUES(?,?,?,?,?,?,?)',
                    (ident, conversation_id, user_message_id, place_name.strip(), now, expires, 'armed'))
    return {'intentId': ident, 'status': 'armed', 'expiresAt': expires}


def cancel_arrival(body):
    ident = _arrival_id(body.get('intentId'))
    with db() as con:
        con.execute('BEGIN IMMEDIATE')
        row = con.execute('SELECT job_id FROM arrival_intents WHERE id=?', (ident,)).fetchone()
        if row:
            con.execute("UPDATE arrival_intents SET status='cancelled' WHERE id=? AND status IN ('armed','arrived')", (ident,))
            if row['job_id']:
                con.execute("UPDATE jobs SET status='cancelled',finished=?,decision='arrival_cancelled' WHERE id=? AND status='queued'", (time.time(), row['job_id']))
    return {'intentId': ident, 'status': 'cancelled'}


def record_arrival(body):
    ident = _arrival_id(body.get('intentId'))
    event_id = _arrival_id(body.get('eventId'))
    evidence = body.get('evidence')
    if not isinstance(evidence, dict) or set(evidence) != {'geofence', 'wifiMatched'} or evidence['geofence'] is not True or type(evidence['wifiMatched']) is not bool:
        raise ValueError('Invalid arrival evidence')
    now = time.time()
    with db() as con:
        con.execute('BEGIN IMMEDIATE')
        intent = con.execute('SELECT * FROM arrival_intents WHERE id=?', (ident,)).fetchone()
        if not intent:
            raise ValueError('Arrival intent unavailable')
        if intent['status'] == 'arrived' and intent['event_id'] == event_id:
            return {'accepted': True, 'intentId': ident, 'jobId': intent['job_id']}
        if intent['status'] != 'armed' or now > intent['expires']:
            raise ValueError('Arrival intent is no longer armed')
        job_id = 'arrival:' + ident
        detail = {'placeName': intent['place_name'], 'geofence': True,
                  'wifiMatched': evidence['wifiMatched'], 'detectedAt': now}
        con.execute('INSERT INTO jobs(id,source,due,status,created,conversation_id,user_message_id,arrival_json) VALUES(?,?,?,?,?,?,?,?)',
                    (job_id, 'place-arrival', now, 'queued', now, intent['conversation_id'], intent['user_message_id'], json.dumps(detail, ensure_ascii=False)))
        con.execute("UPDATE arrival_intents SET status='arrived',event_id=?,arrived=?,evidence_json=?,job_id=? WHERE id=?",
                    (event_id, now, json.dumps(evidence), job_id, ident))
    return {'accepted': True, 'intentId': ident, 'jobId': job_id}


def record_place_event(body):
    """Accept a phone geofence event without an advance chat message or trip."""
    event_id = _arrival_id(body.get('eventId'))
    place_id = _arrival_id(body.get('placeId'))
    place_name = body.get('placeName')
    if not isinstance(place_name, str) or not 1 <= len(place_name.strip()) <= 80:
        raise ValueError('Invalid place name')
    place_name = place_name.strip()
    now = time.time()
    with db() as con:
        con.execute('BEGIN IMMEDIATE')
        old = con.execute('SELECT * FROM arrival_events WHERE event_id=?', (event_id,)).fetchone()
        if old:
            if old['place_id'] != place_id or old['place_name'] != place_name:
                raise ValueError('Arrival event ID already used')
            return {'accepted': True, 'eventId': event_id, 'jobId': old['job_id']}
        recent = con.execute('SELECT job_id FROM arrival_events WHERE place_id=? AND created>? ORDER BY created DESC LIMIT 1',
                             (place_id, now - 6 * 3600)).fetchone()
        job_id = None if recent else 'arrival-event:' + event_id
        con.execute('INSERT INTO arrival_events(event_id,place_id,place_name,created,job_id) VALUES(?,?,?,?,?)',
                    (event_id, place_id, place_name, now, job_id))
        if job_id:
            detail = {'placeName': place_name, 'geofence': True, 'detectedAt': now}
            con.execute('INSERT INTO jobs(id,source,due,status,created,arrival_json) VALUES(?,?,?,?,?,?)',
                        (job_id, 'place-arrival', now, 'queued', now, json.dumps(detail, ensure_ascii=False)))
    return {'accepted': True, 'eventId': event_id, 'jobId': job_id}

def presence(device,busy):
    with db() as con:
        devices=get(con,'presence',{})
        devices={k:v for k,v in devices.items() if v['at']>time.time()-90}
        devices[str(device)[:100]]={'at':time.time(),'busy':bool(busy)}
        put(con,'presence',devices)

def configure(body):
    enabled = body.get('enabled')
    minutes = body.get('intervalMinutes')
    if not isinstance(enabled, bool) or (minutes is not None and
            (type(minutes) is not int or minutes < 30 or minutes > 1440)):
        raise ValueError('Choose an interval from 30 to 1440 minutes')
    prompt = body.get('prompt')
    if 'prompt' in body and (not isinstance(prompt, str) or not prompt.strip() or len(prompt) > PROMPT_LIMIT):
        raise ValueError('Prompt must contain 1 to 8000 characters')
    now = time.time()
    access_value = validate_permissions(body['permissions']) if 'permissions' in body else None
    sleep_value = sleep.validate(body['sleep']) if 'sleep' in body else None
    with db() as con:
        con.execute('BEGIN IMMEDIATE')
        previous = get(con, 'config', {})
        config = {'enabled': enabled, 'intervalMinutes': minutes, 'sleep': sleep_value or previous.get('sleep', dict(sleep.DEFAULT))}
        changed = previous.get('enabled') != enabled or previous.get('intervalMinutes') != minutes
        put(con, 'config', config)
        if 'prompt' in body:put(con, 'task_prompt', prompt)
        if access_value is not None:
            put(con, 'permissions', access_value)
            put(con, 'permission_mode', True)

        if not enabled or not config['sleep']['enabled'] or not config['sleep']['dreamEnabled']:
            con.execute("UPDATE sleep_cycles SET status='skipped' WHERE status='pending'")
        if not enabled:
            con.execute("UPDATE jobs SET status='cancelled',finished=?,decision='disabled' WHERE status='queued' AND source='automation'", (now,))
        quiet = sleep.window(config['sleep'], now)
        if quiet and enabled:
            scheduled = get(con, 'schedule', {})
            if not changed and minutes is None and scheduled.get('mode') == 'agent':
                scheduled = plan.postpone(scheduled, quiet['end'], config['sleep'], now, 'sleep_time')
                put(con, 'schedule', scheduled)
                put(con, 'next_at', scheduled['nextAt'])
            else:
                put(con, 'next_at', quiet['end'])
                if changed:put(con, 'schedule', {})
        elif changed and minutes is not None:
            put(con, 'next_at', now + minutes * 60)
            put(con, 'schedule', {'version': 2, 'drawnAt': now, 'seconds': minutes * 60, 'mode': 'fixed'})
        elif changed:
            put(con, 'schedule', {})
            put(con, 'next_at', None)
    return status()


def update_prompt(body):
    prompt = body.get('prompt')
    if not isinstance(prompt, str) or len(prompt) > PROMPT_LIMIT:
        raise ValueError('Prompt must contain at most 8000 characters')
    with db() as con:
        put(con, 'prompt_addendum', prompt.strip())
    return status()


def workflow_jobs(con, limit=50, offset=0):
    fields = ['id','source','status','created','started','finished','tools','conversation_id','decision','tokens','notification','silent_reason']
    rows = con.execute('SELECT * FROM jobs ORDER BY created DESC,id DESC LIMIT ? OFFSET ?', (limit, offset)).fetchall()
    jobs = [{k: row[k] for k in fields} for row in rows]
    for job, original in zip(jobs, rows):
        for field in ('incoming_plan', 'next_plan'):
            job[field] = json.loads(original[field]) if original[field] else None
        job['plan_error'] = original['plan_error']
        job['tokenUsage'] = token_usage.stored(original['usage_json'], complete=job['status'] not in {'queued','running'})
        calls = []
        for row in con.execute('SELECT item_id,name,status,started,finished,workflow_json FROM calls WHERE job_id=? ORDER BY rowid', (job['id'],)):
            call = dict(row)
            raw = call.pop('workflow_json')
            try: facts = json.loads(raw) if raw else workflow.step(call['name'], failed=call['status']=='failed', uncertain=call['status']=='started')
            except (ValueError, TypeError): facts = workflow.step(call['name'], uncertain=True)
            call.update(facts)
            # Older rows have no structured receipt: do not retrospectively assert completion.
            if not raw and call['status']=='done': call.update(completion='unknown', result='旧记录只保存了接口返回状态，具体完成情况未核对。')
            calls.append(call)
        job['calls'] = calls
        job['error'] = original['error']
        job.update(workflow.describe(job, calls))
        job.pop('error', None)
    return jobs


def workflow_runs(limit=20, offset=0):
    if type(limit) is not int or not 1 <= limit <= 50 or type(offset) is not int or not 0 <= offset <= 10000:
        raise ValueError('Invalid workflow page')
    with db() as con:
        jobs = workflow_jobs(con, limit+1, offset)
        return {'jobs': jobs[:limit], 'nextOffset': offset+limit if len(jobs)>limit else None, 'workflowVersion': 1}


def workflow_run(ident):
    if not isinstance(ident, str) or not ident or len(ident)>128: raise ValueError('Invalid workflow ID')
    with db() as con:
        # Scope is the authenticated single-owner history service, as for /wake.
        row=con.execute('SELECT COUNT(*) FROM jobs WHERE created > (SELECT created FROM jobs WHERE id=?) OR (created = (SELECT created FROM jobs WHERE id=?) AND id > ?)', (ident,ident,ident)).fetchone()
        jobs=workflow_jobs(con, 1, row[0])
        if not jobs or jobs[0]['id'] != ident: raise ValueError('Workflow unavailable')
        return {'job': jobs[0], 'workflowVersion': 1}


def status():
    with db() as con:
        jobs = workflow_jobs(con)
        config = get(con, 'config', {'enabled': get(con, 'frequency', 'daily') != 'off', 'intervalMinutes': None})
        config = dict(config, sleep=config.get('sleep', dict(sleep.DEFAULT)))
        quiet = sleep.window(config['sleep'], time.time()) if config['enabled'] else None
        dream = con.execute('SELECT id,end,status,memory_id,retry_at,error FROM sleep_cycles ORDER BY end DESC LIMIT 1').fetchone()
        permission_mode = get(con, 'permission_mode', False)
        addendum = get(con, 'prompt_addendum', '')
        base = DEFAULT_PROMPT if permission_mode else get(con, 'task_prompt', DEFAULT_PROMPT)
        recovery = get(con, 'recovery', {})
        paused = bool(recovery.get('reason') in {'quota', 'authentication'} or (recovery.get('retryAt') or 0) > time.time())
        recovery = dict(recovery, paused=paused)
        return {'workflowVersion': 1, 'configVersion': 6, 'permissionVersion': 1, 'sleepVersion': 1,
                'sleep': {'sleeping': bool(quiet), 'until': quiet['end'] if quiet else None, 'lastDream': dict(dream) if dream else None},
                'permissions': get(con, 'permissions', {'tools': TOOL_OPTIONS, 'messages': MESSAGE_OPTIONS}),
                'backgroundVoice': {'enabled': bool(get(con, 'background_voice', None))},
                'toolOptions': TOOL_OPTIONS, 'messageOptions': MESSAGE_OPTIONS,
                'prompt': compose_prompt(base, addendum, get(con, 'rowan_self_prompt', '')),
                'promptAddendum': addendum, 'promptMode': 'append',
                'selfPrompt': get(con, 'rowan_self_prompt', ''), 'selfPromptUpdatedAt': get(con, 'rowan_self_prompt_updated_at'),
                'planningVersion': 1,
                'defaultPrompt': DEFAULT_PROMPT, 'promptMaxLength': PROMPT_LIMIT, 'config': config, 'enabled': config['enabled'],
                'executor': 'vps', 'conversationId': jobs[0]['conversation_id'] if jobs else None,
                'heartbeat': get(con, 'heartbeat', 0), 'nextAt': max(quiet['end'], get(con, 'next_at') or 0) if quiet else None if paused else get(con, 'next_at'), 'scheduledNextAt': get(con, 'next_at'),
                'schedule': get(con, 'schedule'), 'frequency': get(con, 'frequency'),
                'lastJob': jobs[0] if jobs else None, 'jobs': jobs, 'schedulerError': get(con, 'error'),
                'recoveryVersion': 1, 'recovery': recovery,
                'toolRecovery': get(con, 'tool_recovery', {}),
                'uncertainWrites': list(get(con, 'uncertain_writes', {}).values())}


def request_health_check():
    with db() as con:put(con, 'health_check_requested', True)
    return status()
