#!/bin/sh
set -eu
mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME"
mkdir -p "$XDG_CONFIG_HOME/pcmanfm/Vesper" /var/lib/vesper-desktop/Desktop
cp /etc/vesper-desktop/user-dirs.dirs "$XDG_CONFIG_HOME/user-dirs.dirs"
cp /etc/vesper-desktop/desktop-items-0.conf "$XDG_CONFIG_HOME/pcmanfm/Vesper/desktop-items-0.conf"
openbox --config-file /etc/vesper-desktop/openbox.xml &
wm_pid=$!
trap 'kill "$wm_pid" 2>/dev/null || true' EXIT INT TERM
pcmanfm --desktop --profile Vesper &
tint2 -c /etc/vesper-desktop/tint2rc &
xterm -title 'VPS processes' -geometry 76x24+28+38 -bg '#131b29' -fg '#e8eff8' -fa Monospace -fs 10 -e /usr/bin/top -d 3 &
wait "$wm_pid"
