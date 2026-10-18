from __future__ import annotations
import hmac
from urllib.parse import urlparse, parse_qs

def dispatch(self, path, services):
    activity = services.activity
    db = services.db
    message = services.message
    if path == ['activity'] and self.command == 'GET':
        try:
            month = parse_qs(urlparse(self.path).query).get('month', [''])[0]
            with db() as connection:
                result = activity.month_activity(connection, month)
            self.send_json(200, result)
        except ValueError:
            self.send_json(400, {'error': 'Expected month YYYY-MM'})
        return True
    if path == ['health'] and self.command == 'GET':
        self.send_json(200, {'ok': True})
        return True
    if path == ['search'] and self.command == 'GET':
        self.search_messages()
        return True
    if path == ['inbox'] and self.command == 'GET':
        self.inbox()
        return True
    if path == ['conversations'] and self.command == 'GET':
        self.list_conversations()
        return True
    if len(path) == 2 and path[0] == 'conversations':
        if self.command == 'GET':
            self.get_conversation(path[1])
        elif self.command in {'POST', 'PATCH'}:
            self.upsert_conversation(path[1])
        elif self.command == 'DELETE':
            self.delete_conversation(path[1])
        else:
            self.send_json(405, {'error': 'Method not allowed'})
        return True
    if len(path) == 3 and path[0] == 'conversations' and (path[2] == 'wake-history') and (self.command == 'GET'):
        with db() as connection:
            rows = connection.execute("SELECT * FROM messages\n                  WHERE vesper_conversation_id = ?\n                    AND (json_extract(metadata_json, '$.wakeRunId') IS NOT NULL\n                         OR json_extract(metadata_json, '$.wake') IS NOT NULL)\n                  ORDER BY created_at DESC, rowid DESC LIMIT 100", (path[1],)).fetchall()
        self.send_json(200, {'messages': [message(row) for row in rows], 'limit': 100})
        return True
    if len(path) == 3 and path[0] == 'conversations' and (path[2] == 'messages') and (self.command == 'POST'):
        self.upsert_message(path[1])
        return True
    if len(path) == 4 and path[0] == 'conversations' and (path[2] == 'messages') and (self.command == 'DELETE'):
        self.delete_message(path[1], path[3])
        return True
    return False
