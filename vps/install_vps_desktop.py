"""Install the real desktop onto the VPS's existing private X11 display."""
import argparse
import grp
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

parser = argparse.ArgumentParser()
parser.add_argument('--expected-server-sha', required=True)
args = parser.parse_args()
source = Path(__file__).resolve().parent
if os.geteuid() != 0:
    raise SystemExit('Run with sudo.')
if Path('/run/vesper-browser/login-mode').exists():
    raise SystemExit('Finish owner login before installing the desktop.')
if hashlib.sha256(Path('/opt/vesper-browser/server.py').read_bytes()).hexdigest() != args.expected_server_sha:
    raise SystemExit('Browser source changed since review.')
for name in ['openbox', 'pcmanfm', 'tint2', 'xterm', 'dbus-run-session']:
    if not shutil.which(name):
        raise SystemExit('Install Ubuntu desktop dependencies before proceeding.')
unit = Path('/etc/systemd/system/vesper-desktop.service')
targets = {
    unit: source/'desktop/vesper-desktop.service',
    Path('/opt/vesper-desktop/session.sh'): source/'desktop/session.sh',
    Path('/etc/vesper-desktop/openbox.xml'): source/'desktop/openbox.xml',
    Path('/etc/vesper-desktop/tint2rc'): source/'desktop/tint2rc',
    Path('/etc/vesper-desktop/user-dirs.dirs'): source/'desktop/user-dirs.dirs',
    Path('/etc/vesper-desktop/desktop-items-0.conf'): source/'desktop/desktop-items-0.conf',
}
authority = Path('/etc/vesper-desktop/Xauthority')
previous = {p: p.read_bytes() if p.exists() else None for p in [*targets, authority]}
backup = Path('/var/backups/vesper-desktop')/str(time.time_ns())
backup.mkdir(parents=True, mode=0o700)
for number, data in enumerate(previous.values()):
    if data is not None:
        p = backup/str(number); p.write_bytes(data); p.chmod(0o600)
was_active = subprocess.run(['systemctl', 'is-active', '--quiet', unit.name]).returncode == 0
was_enabled = subprocess.run(['systemctl', 'is-enabled', '--quiet', unit.name], stderr=subprocess.DEVNULL).returncode == 0

def write(path, data, mode=0o644, group=0):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name+'.desktop-update')
    fd = os.open(temporary, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, mode)
    try:
        with os.fdopen(fd, 'wb') as output: output.write(data)
        os.chmod(temporary, mode); os.chown(temporary, 0, group)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)

try:
    for target, origin in targets.items():
        write(target, origin.read_bytes(), 0o755 if target.suffix == '.sh' else 0o644)
    write(authority, Path('/etc/vesper-browser/Xauthority').read_bytes(), 0o640, grp.getgrnam('ubuntu').gr_gid)
    subprocess.run(['systemd-analyze', 'verify', str(unit)], check=True)
    subprocess.run(['systemctl', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', 'enable', unit.name], check=True)
    subprocess.run(['systemctl', 'restart', unit.name], check=True)
    time.sleep(2)
    subprocess.run(['systemctl', 'is-active', '--quiet', unit.name], check=True)
    subprocess.run([sys.executable, str(source/'install_browser_display.py'),
        '--expected-server-sha', args.expected_server_sha], check=True)
except Exception:
    subprocess.run(['systemctl', 'stop', unit.name], check=False)
    if not was_enabled: subprocess.run(['systemctl', 'disable', unit.name], check=False)
    for path, data in previous.items():
        if data is None: path.unlink(missing_ok=True)
        else: write(path, data, 0o640 if path == authority else 0o755 if path.suffix == '.sh' else 0o644,
            grp.getgrnam('ubuntu').gr_gid if path == authority else 0)
    subprocess.run(['systemctl', 'daemon-reload'], check=False)
    if was_active: subprocess.run(['systemctl', 'start', unit.name], check=False)
    raise
print('VPS_DESKTOP_INSTALLED · actual X11 desktop, existing browser and Codex services retained')
