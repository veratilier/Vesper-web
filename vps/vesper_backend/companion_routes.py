from __future__ import annotations
import hmac
from urllib.parse import urlparse, parse_qs

def dispatch(self, path, services):
    companion_poke = services.companion_poke
    db = services.db
    screen_companion = services.screen_companion
    if path == ['companion', 'watch'] and self.command == 'POST':
        status, value = screen_companion.dispatch(db, self.body())
        self.send_json(status, value)
        return True
        return True
    if len(path) == 4 and path[:2] == ['companion', 'watch'] and (self.command == 'GET'):
        status, value = screen_companion.poll(db, path[2], path[3])
        self.send_json(status, value)
        return True
        return True
    if path == ['companion', 'poke'] and self.command == 'POST':
        status, value = companion_poke.enqueue(db, self.body())
        self.send_json(status, value)
        return True
        return True
    return False
