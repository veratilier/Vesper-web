#!/usr/bin/env python3
"""Install from the checked Vesper checkout on its existing VPS; keep backups."""
from pathlib import Path
import py_compile,subprocess,shutil,datetime,os
source=Path(__file__).parent
root=Path('/home/ubuntu/vesper-codex-history')
if not root.is_dir():raise SystemExit('Existing Vesper VPS runner is required')
files=['vesper_emotion_settler.py','vesper_wake_runner.py','vesper_wake_policy.py']
for name in files:py_compile.compile(str(source/name),doraise=True)
backup=root/'deploy-backups'/('emotions-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S'))
backup.mkdir(parents=True,mode=0o700)
for name in files:
    if (root/name).exists():shutil.copy2(root/name,backup/name)
    shutil.copy2(source/name,root/name);os.chmod(root/name,0o600)
for name in ['vesper-emotion.service','vesper-emotion.timer']:
    destination=Path('/etc/systemd/system')/name
    if destination.exists():shutil.copy2(destination,backup/name)
    subprocess.run(['sudo','install','-o','root','-g','root','-m','644',str(source/name),str(destination)],check=True)
subprocess.run(['sudo','systemctl','daemon-reload'],check=True)
subprocess.run(['sudo','systemctl','enable','--now','vesper-emotion.timer'],check=True)
# Exactly one catch-up assessment. Persistent timers do not replay missed intervals.
subprocess.run(['sudo','systemctl','start','--no-block','vesper-emotion.service'],check=True)
print('Installed Desire v0.3; backup:',backup)
