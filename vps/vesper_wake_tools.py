"""Explicit unattended permissions; external results never grant new permissions."""
import copy, hashlib

SEND_TYPES = {'chat_capture_messages': 'photos', 'album_send_photos': 'photos', 'send_chat_file': 'files', 'sticker_send': 'stickers'}


def allowed_tools(access, ceiling):
    return {name for name in ceiling if name in access['tools'] and
            (name not in SEND_TYPES or SEND_TYPES[name] in access['messages'])}


def message_allowed(access, record):
    kind = SEND_TYPES.get(record['name'])
    return kind is not None and kind in access['messages'] and record['name'] in access['tools']

def external_catalog(result, authorized_connections=()):
    """Full tool access only for connections explicitly authorized by the owner."""
    result=copy.deepcopy(result)
    result['connections']=[c for c in result.get('connections', [])
        if c.get('connectionId') in authorized_connections]
    return result


def tool_input(name, arguments, job_id, item_id, catalog):
    args = copy.deepcopy(arguments)
    if name == 'write_vesper_state' and args.get('kind') not in {'note', 'journal'}:
        raise RuntimeError('Background writes are limited to notes and journal')
    if name == 'manage_vesper_memory' and args.get('action') != 'list':
        raise RuntimeError('Use remember_vesper_memory to add; editing/deleting memories requires a specific user request')
    if name == 'desire_encounter':
        args['interaction_source'] = 'automation'
        # One event per round; repeated events cannot earn multiple encounters.
        args['request_id'] = 'wake-' + hashlib.sha256(job_id.encode()).hexdigest()
    if name in {'bookmark_create', 'jotting_create', 'letter_create'}:
        args['id'] = 'wake-' + hashlib.sha256((job_id + ':' + item_id).encode()).hexdigest()
    if name == 'reading_room_annotate':
        args['noteId'] = 'wake-' + hashlib.sha256((job_id + ':' + item_id).encode()).hexdigest()
    if name == 'call_configured_mcp_tool':
        connection = next((c for c in catalog.get('connections', []) if c.get('connectionId') == args.get('connectionId')), None)
        tool = args.get('toolName')
        if not connection or not any(t.get('name') == tool for t in connection.get('tools', [])):
            raise RuntimeError('List configured MCP tools first and select an authorized forum tool')
        nested = args.get('arguments', {})
        if not isinstance(nested, dict):
            raise RuntimeError('Invalid MCP arguments')
        args['arguments'] = nested
    return args


def required_desire_input(value):
    if not isinstance(value, dict) or value.get('kind') not in {'warmth', 'absence', 'repair', 'shared_work', 'flirt'}:
        raise RuntimeError('Missing required Desire assessment')
    note = value.get('note')
    if not isinstance(note, str) or not note.strip() or len(note) > 1200:
        raise RuntimeError('A nonempty Desire note is required')
    return {'kind': value['kind'], 'note': note.strip(), 'surface': 'chat', 'interaction_source': 'automation'}
