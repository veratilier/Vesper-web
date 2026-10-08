"""Install the display adapter beside the existing browser; preserve all other services."""
import argparse
import grp
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--expected-server-sha', required=True)
args = parser.parse_args()
if os.geteuid() != 0:
    raise SystemExit('Run with sudo on the existing Vesper VPS.')
if Path('/run/vesper-browser/login-mode').exists():
    raise SystemExit('Finish the owner browser login before updating its service.')
source = Path(__file__).resolve().parent
server = Path('/opt/vesper-browser/server.py')
module = server.with_name('vesper_browser_display.py')
nginx = Path('/etc/nginx/snippets/vesper-browser.conf')
token = Path('/etc/vesper-browser/display-token')
original = server.read_bytes()
if hashlib.sha256(original).hexdigest() != args.expected_server_sha:
    raise SystemExit('Browser source changed since inspection; review it before retrying.')
hook = "from vesper_browser_display import install as install_display\ninstall_display(app,browser,LOGIN,display_url,TOKEN)\n"
text = original.decode()
if 'install_display(app,browser,LOGIN,display_url,TOKEN)' not in text:
    needle = "if __name__=='__main__':"
    if text.count(needle) != 1:
        raise SystemExit('The current browser startup does not match the reviewed adapter hook.')
    text = text.replace(needle, hook + needle)
adapter = (source/'vesper_browser_display.py').read_bytes()
compile(text, str(server), 'exec'); compile(adapter, str(module), 'exec')
route = '''
# Native Vesper owner view; the browser MCP retains its separate credential.
location = /browser/display {
    access_log off;
    client_max_body_size 1k;
    limit_req zone=vesper_browser burst=4 nodelay;
    proxy_pass http://127.0.0.1:8784/browser/display;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header Origin $http_origin;
    proxy_read_timeout 8s;
    proxy_buffering off;
}
'''
nginx_text = nginx.read_text()
if 'location = /browser/display' not in nginx_text:
    nginx_text += route
backup = Path('/var/backups/vesper-display')/str(time.time_ns())
backup.mkdir(parents=True, mode=0o700)
originals = {p: p.read_bytes() if p.exists() else None for p in [server, module, nginx, token]}
for path, data in originals.items():
    if data is not None:
        destination = backup/path.name; destination.write_bytes(data); destination.chmod(0o600)

def atomic(path, data, mode, group=0):
    tmp = path.with_name(path.name + '.display-update')
    fd = os.open(tmp, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, mode)
    try:
        with os.fdopen(fd, 'wb') as output: output.write(data)
        os.chmod(tmp, mode); os.chown(tmp, 0, group); os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)

device_token = Path('/home/ubuntu/.codex/app-server-token').read_text().strip()
if len(device_token) < 32:
    raise SystemExit('Existing Vesper pairing credential is unavailable.')
try:
    if server.read_bytes() != original:
        raise RuntimeError('Browser source changed during preparation.')
    atomic(module, adapter, 0o644)
    atomic(server, text.encode(), 0o644)
    atomic(token, device_token.encode(), 0o640, grp.getgrnam('vesper-browser').gr_gid)
    atomic(nginx, nginx_text.encode(), 0o644)
    subprocess.run(['nginx', '-t'], check=True)
    subprocess.run(['systemctl', 'restart', 'vesper-browser.service'], check=True)
    confirmed = False
    for _ in range(20):
        try:
            request = urllib.request.Request('http://127.0.0.1:8784/browser/display', headers={'Authorization': 'Bearer '+device_token})
            with urllib.request.urlopen(request, timeout=5) as response:
                confirmed = json.load(response).get('state') == 'idle'
            if confirmed: break
        except OSError: time.sleep(1)
    if not confirmed:
        raise RuntimeError('New browser display did not pass authenticated startup verification.')
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
except Exception:
    for path, data in originals.items():
        if data is None: path.unlink(missing_ok=True)
        else:
            shutil.copyfile(backup/path.name, path)
            path.chmod(0o640 if path == token else 0o644)
            if path == token: os.chown(path, 0, grp.getgrnam('vesper-browser').gr_gid)
    subprocess.run(['nginx', '-t'], check=False)
    subprocess.run(['systemctl', 'restart', 'vesper-browser.service'], check=False)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=False)
    raise
print('DISPLAY_INSTALLED_AND_AUTHENTICATED · browser MCP, model/chat/history services preserved')
