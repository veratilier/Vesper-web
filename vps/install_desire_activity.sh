#!/usr/bin/env bash
# Run as the existing wake account; do not replace its customized runner.
set -euo pipefail
umask 077
if [[ $(id -u) == 0 ]]; then
  echo 'Run as the existing Vesper wake account, not root.' >&2
  exit 1
fi
asset_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
live_runner=${1:-/home/ubuntu/vesper-codex-history/vesper_wake_runner.py}
xinchao_dir=${VESPER_XINCHAO_DIR:-$HOME/.vesper/xinchao}
xinchao_dropin=/etc/systemd/system/vesper-wake.service.d/xinchao.conf
python3 "$asset_dir/patch_desire_activity_runner.py" "$live_runner" --check
sudo -n true
if [[ -f "$xinchao_dropin" ]]; then
  # Only the exact drop-in produced by the old installer belongs to this migration.
  expected_dropin=$(printf '[Service]\nEnvironmentFile="%s"\n' "$xinchao_dir/wake.env")
  if [[ $(sudo -n cat "$xinchao_dropin") != "$expected_dropin" ]]; then
    echo 'Custom Xinchao drop-in found; review it before migration.' >&2
    exit 1
  fi
fi
if [[ -f "$xinchao_dir/compose.yaml" ]]; then
  docker compose version >/dev/null
  docker info >/dev/null
fi
timer_was_active=false
if sudo -n systemctl is-active --quiet vesper-wake.timer; then timer_was_active=true; fi
sudo -n systemctl stop vesper-wake.timer
resume_timer() {
  if [[ "$timer_was_active" == true ]]; then sudo -n systemctl start vesper-wake.timer; fi
}
trap resume_timer EXIT
if sudo -n systemctl is-active --quiet vesper-wake.service; then
  echo 'A wake is running; it was not interrupted. Retry after it finishes.' >&2
  exit 1
fi
# Recheck after pausing, then back up and atomically patch just the integration hooks.
python3 "$asset_dir/patch_desire_activity_runner.py" "$live_runner"
if [[ -f "$xinchao_dir/compose.yaml" ]]; then
  docker compose -p vesper-xinchao -f "$xinchao_dir/compose.yaml" stop xinchao
fi
if [[ -f "$xinchao_dropin" ]]; then
  backup_dropin=$(mktemp "$xinchao_dir/systemd.conf.before-desire-activity-XXXXXX")
  sudo -n cat "$xinchao_dropin" > "$backup_dropin"
  sudo -n rm -- "$xinchao_dropin"
  sudo -n systemctl daemon-reload
fi
echo 'Subsequent existing wakes use native Desire and activity continuation. No extra wake was triggered.'
echo 'Previous Xinchao data, volume and token were retained; existing Desire values were not changed.'
