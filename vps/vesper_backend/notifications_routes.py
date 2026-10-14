from __future__ import annotations
import hmac
from urllib.parse import urlparse, parse_qs

def dispatch(self, path, services):
    bark = services.bark
    db = services.db
    if path == ['notifications', 'bark'] and self.command in ('GET', 'POST'):
        if self.command == 'GET':
            with db() as connection:
                value = bark.settings(connection)
            self.send_json(200, value)
            return True
        body = self.body()
        if body.get('action') == 'test':
            value = bark.refresh_profile(db, self.watch_secret())
            try:
                bark.send(value, 'Bark 已连接，离开聊天后会在整轮回复完成时提醒你。')
                self.send_json(200, {'ok': True})
                return True
            except Exception:
                self.send_json(502, {'error': 'Bark delivery could not be confirmed'})
                return True
        with db() as connection:
            value = bark.configure(connection, body)
        self.send_json(200, value)
        return True
        return True
    if path == ['notifications', 'bark', 'presence'] and self.command == 'POST':
        with db() as connection:
            bark.presence(connection, self.body())
        self.send_json(200, {'ok': True})
        return True
        return True
    return False
