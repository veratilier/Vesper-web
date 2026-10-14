from __future__ import annotations
import hmac
from urllib.parse import urlparse, parse_qs

def dispatch(self, path, services):
    activity = services.activity
    chat_screenshot = services.chat_screenshot
    db = services.db
    generated_images = services.generated_images
    message = services.message
    music_search = services.music_search
    terminal = services.terminal
    wake_store = services.wake_store
    watch = services.watch
    if len(path) == 3 and path[0] == 'conversations' and (path[2] == 'screenshot') and (self.command == 'POST'):
        try:
            body = self.body()
            if body.get('perspective') != 'agent':
                raise ValueError('Screenshot perspective must be agent')
            with db() as connection:
                data = chat_screenshot.select_messages(connection, path[1], body.get('messageIds'))
            self.send_json(200, chat_screenshot.render(data, self.watch_secret()))
        except chat_screenshot.ScreenshotUnavailable as error:
            self.send_json(503, {'error': str(error)})
        except ValueError as error:
            self.send_json(400, {'error': str(error)})
        return True
    if len(path) == 3 and path[0] == 'conversations' and (path[2] == 'generated-image') and (self.command == 'POST'):
        body = self.body()
        try:
            with db() as connection:
                image = generated_images.export_image(connection, path[1], body.get('threadId'), body.get('path'))
            self.send_json(200, image)
        except ValueError as error:
            self.send_json(400, {'error': str(error)})
        return True
    if path and path[0] == 'watch':
        try:
            if path == ['watch'] and self.command == 'POST':
                self.send_json(202, watch.start(self.body().get('url')))
            elif len(path) == 2 and self.command == 'DELETE':
                self.send_json(200, watch.release(path[1]))
            elif len(path) == 2 and self.command == 'GET':
                data = watch.read(path[1])
                if data['status'] == 'ready':
                    expiry = int(data['created'] + watch.TTL)
                    data['streamPath'] = f'/watch/{path[1]}/stream?expires={expiry}&ticket={watch.ticket(path[1], expiry, self.watch_secret())}'
                self.send_json(200, data)
            else:
                self.send_json(405, {'error': 'Method not allowed'})
        except (ValueError, OSError):
            self.send_json(400, {'error': '导入不可用：请确认完整 B 站链接，且没有其他视频正在准备或缓存已满。'})
        return True
    return False

def public(self, parts, services):
    bark = services.bark
    watch = services.watch
    if len(parts) == 3 and parts[0] == 'watch' and (parts[2] == 'stream') and (self.command == 'GET'):
        watch.serve(self, parts[1])
        return True
        return True
    if len(parts) == 4 and parts[:3] == ['notifications', 'bark', 'icon'] and (self.command == 'GET'):
        digest = parts[3]
        ticket = parse_qs(urlparse(self.path).query).get('ticket', [''])[0]
        if len(digest) != 64 or any((c not in '0123456789abcdef' for c in digest)) or (not hmac.compare_digest(ticket, bark.icon_ticket(digest, self.watch_secret()))):
            self.send_json(404, {'error': 'Icon unavailable'})
            return True
        file = bark.ROOT / (digest + '.image')
        if not file.is_file():
            self.send_json(404, {'error': 'Icon unavailable'})
            return True
        data = file.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', 'image/png' if data.startswith(b'\x89PNG') else 'image/jpeg')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'public, max-age=604800, immutable')
        self.end_headers()
        self.wfile.write(data)
        return True
        return True
    return False
