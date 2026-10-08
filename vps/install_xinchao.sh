#!/usr/bin/env bash
# Run as the existing wake service account (normally ubuntu), not root.
set -euo pipefail
umask 077
if [[ $(id -u) == 0 ]]; then
  echo 'Run this as the existing Vesper wake account, not root.' >&2
  exit 1
fi
command -v git >/dev/null
command -v python3 >/dev/null
docker compose version >/dev/null
docker info >/dev/null
asset_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
install_dir=${VESPER_XINCHAO_DIR:-$HOME/.vesper/xinchao}
live_runner=${1:-/home/ubuntu/vesper-codex-history/vesper_wake_runner.py}
upstream_commit=a38a0a3241b0d3928d4a452ea1a38cf7efa14cd3
mkdir -p -- "$install_dir"
chmod 700 "$install_dir"
# Check live compatibility before fetching, building or changing services.
python3 "$asset_dir/patch_xinchao_runner.py" "$live_runner" --check
sudo -n true
if [[ ! -d "$install_dir/source/.git" ]]; then
  git clone https://github.com/tianyupaipai-cmd/xinchao-nian.git "$install_dir/source"
fi
git -C "$install_dir/source" diff --quiet
git -C "$install_dir/source" diff --cached --quiet
git -C "$install_dir/source" fetch origin "$upstream_commit"
git -C "$install_dir/source" checkout --detach "$upstream_commit"
[[ $(git -C "$install_dir/source" rev-parse HEAD) == "$upstream_commit" ]]
cp -- "$asset_dir/xinchao.compose.yaml" "$install_dir/compose.yaml"
python3 - "$install_dir" <<'PY'
import os, secrets, sys
from pathlib import Path
root = Path(sys.argv[1])
token_file = root / 'token'
if not token_file.exists():
    token_file.write_text(secrets.token_hex(32) + '\n')
os.chmod(token_file, 0o600)
token = token_file.read_text().strip()
if len(token) != 64 or any(c not in '0123456789abcdef' for c in token):
    raise SystemExit('Existing token must be 64 hexadecimal characters; nothing was rotated.')
(root/'service.env').write_text('SERVICE_TOKEN=' + token + '\n')
(root/'wake.env').write_text('VESPER_XINCHAO_ENABLED=true\nVESPER_XINCHAO_URL=http://127.0.0.1:18110\nVESPER_XINCHAO_TOKEN_FILE=' + str(token_file) + '\n')
for name in ('service.env', 'wake.env'):
    os.chmod(root/name, 0o600)
PY
docker compose -p vesper-xinchao -f "$install_dir/compose.yaml" up -d --build --wait --wait-timeout 120
VESPER_XINCHAO_TOKEN_FILE="$install_dir/token" PYTHONPATH="$asset_dir" python3 - <<'PY'
from vesper_xinchao import Client
state = Client().request('/v1/state')
assert isinstance(state.get('drives'), dict), 'Authenticated state check failed'
print('Xinchao authenticated state check passed.')
PY
sudo -n systemctl stop vesper-wake.timer
resume_timer() { sudo -n systemctl start vesper-wake.timer; }
trap resume_timer EXIT
if sudo -n systemctl is-active --quiet vesper-wake.service; then
  echo 'A wake is running. It was not interrupted; retry once it finishes.' >&2
  exit 1
fi
python3 "$asset_dir/patch_xinchao_runner.py" "$live_runner"
sudo -n mkdir -p /etc/systemd/system/vesper-wake.service.d
printf '[Service]\nEnvironmentFile="%s"\n' "$install_dir/wake.env" > "$install_dir/systemd.conf"
sudo -n install -m 644 "$install_dir/systemd.conf" /etc/systemd/system/vesper-wake.service.d/xinchao.conf
sudo -n systemctl daemon-reload
echo 'Xinchao is healthy and enabled for subsequent existing Vesper wakes; no extra wake was triggered.'
