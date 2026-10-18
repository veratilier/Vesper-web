from __future__ import annotations
import hmac
from urllib.parse import urlparse, parse_qs

def dispatch(self, path, services):
    activity = services.activity
    db = services.db
    message = services.message
    wake_store = services.wake_store
    if path == ['wake'] and self.command == 'GET':
        query = parse_qs(urlparse(self.path).query)
        if query.get('view') == ['workflow']:
            try:
                self.send_json(200, wake_store.workflow_run(query['id'][0]) if query.get('id') else wake_store.workflow_runs(int(query.get('limit', ['20'])[0]), int(query.get('offset', ['0'])[0])))
            except ValueError:
                self.send_json(400, {'error': 'Invalid workflow page'})
        else:
            self.send_json(200, wake_store.status())
        return True
    if path == ['wake'] and self.command == 'POST':
        body = self.body()
        if body.get('action') == 'presence':
            wake_store.presence(body.get('deviceId', 'web'), body.get('busy', False))
            self.send_json(200, {'ok': True})
        elif body.get('action') == 'configure':
            try:
                self.send_json(200, wake_store.configure(body))
            except ValueError as error:
                self.send_json(400, {'error': str(error)})
        elif body.get('action') == 'backgroundVoice':
            try:
                self.send_json(200, wake_store.configure_background_voice(body))
            except ValueError as error:
                self.send_json(400, {'error': str(error)})
        elif body.get('action') == 'prompt':
            try:
                self.send_json(200, wake_store.update_prompt(body))
            except ValueError as error:
                self.send_json(400, {'error': str(error)})
        elif body.get('action') == 'check':
            self.send_json(202, wake_store.request_health_check())
        elif body.get('action') == 'request':
            ident = wake_store.request(body.get('requestId'))
            self.send_json(202, {'ok': True, 'requestId': ident, 'conversationId': None})
        else:
            self.send_json(400, {'error': 'Unknown wake action'})
        return True
    return False
