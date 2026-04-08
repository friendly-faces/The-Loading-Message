#!/usr/bin/env bash
# Idempotent installer for The Loading Message kiosk on Raspberry Pi OS Lite.
# Designed to coexist with an existing Pi-hole install — touches no networking,
# no DNS, no lighttpd, no port 80.
#
# Usage:  sudo ./install.sh <path-to-dist-dir>
#   <path-to-dist-dir> must contain index.html, message.json, config.json
set -euo pipefail

if [ "$(id -u)" != "0" ]; then
  echo "must run as root (sudo)" >&2
  exit 1
fi

dist_src="${1:-}"
if [ -z "$dist_src" ] || [ ! -d "$dist_src" ]; then
  echo "usage: sudo $0 <path-to-dist-dir>" >&2
  exit 1
fi
dist_src="$(cd "$dist_src" && pwd)"

if [ ! -f "$dist_src/config.json" ]; then
  echo "FAIL: $dist_src/config.json missing." >&2
  echo "Copy config.example.json to config.json and fill in the secret first." >&2
  exit 1
fi
if [ ! -f "$dist_src/message.json" ] || [ ! -f "$dist_src/index.html" ]; then
  echo "FAIL: $dist_src is missing index.html or message.json" >&2
  exit 1
fi

here="$(cd "$(dirname "$0")" && pwd)"

echo "==> installing kiosk packages (no desktop, no display manager)"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  xserver-xorg x11-xserver-utils xinit \
  chromium-browser unclutter rsync

echo "==> deploying web bundle to /opt/loading-message/web"
install -d -m 0755 /opt/loading-message
install -d -m 0755 /opt/loading-message/web
rsync -a --delete "$dist_src/" /opt/loading-message/web/
chown -R pi:pi /opt/loading-message
chmod 0600 /opt/loading-message/web/config.json
chown pi:pi /opt/loading-message/web/config.json

echo "==> installing pi user dotfiles"
install -m 0644 -o pi -g pi "$here/files/bash_profile" /home/pi/.bash_profile
install -m 0755 -o pi -g pi "$here/files/xinitrc"      /home/pi/.xinitrc

echo "==> enabling autologin on tty1 (Pi-hole untouched)"
install -d -m 0755 /etc/systemd/system/getty@tty1.service.d
install -m 0644 "$here/files/getty-autologin.conf" \
  /etc/systemd/system/getty@tty1.service.d/autologin.conf
systemctl daemon-reload

echo
echo "==> done. reboot when ready:  sudo reboot"
echo "    Pi-hole services were not modified."
