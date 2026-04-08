#!/usr/bin/env bash
# One-shot installer for The Loading Message standalone python client.
# Runs on the Pi itself. Idempotent — safe to re-run.
#
#   1. ssh pi@<host>
#   2. git clone <this repo> ~/loading-message
#   3. cd ~/loading-message/pi
#   4. cp local.env.example local.env  &&  $EDITOR local.env   # set SECRET_KEY etc
#   5. sudo ./setup.sh
#   6. sudo reboot
#
# After reboot the Pi boots straight into the percentage on tty1.
# Pi-hole stays untouched.
set -euo pipefail

if [ "$(id -u)" != "0" ]; then
  echo "must run as root (sudo $0)" >&2
  exit 1
fi

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/.." && pwd)"

env_file="$here/local.env"
if [ ! -f "$env_file" ]; then
  echo "FAIL: $env_file missing." >&2
  echo "Copy local.env.example to local.env and fill in SECRET_KEY, START_DATE, TARGET_DATE." >&2
  exit 1
fi

# --------------------------------------------------------------------------
# 1. Undo the previous chromium kiosk attempt (if it ran).
# --------------------------------------------------------------------------
echo "==> tearing down any leftover chromium kiosk setup"

# Old auto-startx hook in pi's bash_profile.
if [ -f /home/pi/.bash_profile ] && grep -q 'startx' /home/pi/.bash_profile 2>/dev/null; then
  rm -f /home/pi/.bash_profile
  echo "    removed /home/pi/.bash_profile"
fi

# Old xinitrc that launched chromium.
if [ -f /home/pi/.xinitrc ] && grep -q 'chromium' /home/pi/.xinitrc 2>/dev/null; then
  rm -f /home/pi/.xinitrc
  echo "    removed /home/pi/.xinitrc"
fi

# Old getty autologin drop-in (we want getty@tty1 fully disabled instead).
if [ -f /etc/systemd/system/getty@tty1.service.d/autologin.conf ]; then
  rm -f /etc/systemd/system/getty@tty1.service.d/autologin.conf
  rmdir /etc/systemd/system/getty@tty1.service.d 2>/dev/null || true
  echo "    removed getty@tty1 autologin drop-in"
fi

# Old web bundle directory.
if [ -d /opt/loading-message/web ]; then
  rm -rf /opt/loading-message/web
  echo "    removed /opt/loading-message/web"
fi

# --------------------------------------------------------------------------
# 2. Install runtime deps (apt + pip). Pi-hole untouched.
# --------------------------------------------------------------------------
echo "==> installing python3 + cryptography"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends python3 python3-pip python3-cryptography

# Sanity check: cryptography importable?
if ! python3 -c "import cryptography" >/dev/null 2>&1; then
  echo "    apt python3-cryptography missing, falling back to pip"
  python3 -m pip install --break-system-packages cryptography
fi

# --------------------------------------------------------------------------
# 3. Deploy script + ciphertext.
# --------------------------------------------------------------------------
echo "==> installing /opt/loading-message"
install -d -m 0755 /opt/loading-message
install -m 0755 "$here/loading_message.py" /opt/loading-message/loading_message.py
install -m 0640 -o pi -g pi "$repo/api/message.json" /opt/loading-message/message.json

# --------------------------------------------------------------------------
# 4. Secret env file (root:root, 0600). Sourced by the systemd unit.
# --------------------------------------------------------------------------
echo "==> writing /etc/loading-message/env"
install -d -m 0755 /etc/loading-message
install -m 0600 -o root -g root "$env_file" /etc/loading-message/env

# --------------------------------------------------------------------------
# 5. systemd unit. Owns tty1 fullscreen, no login prompt, no desktop.
# --------------------------------------------------------------------------
echo "==> installing systemd unit"
install -m 0644 "$here/loading-message-standalone.service" \
  /etc/systemd/system/loading-message-standalone.service

systemctl daemon-reload

# Free tty1 so the service can own it. (Pi-hole's services live elsewhere.)
systemctl disable --now getty@tty1.service 2>/dev/null || true
systemctl set-default multi-user.target >/dev/null

# Stop any previous instance, then enable + start fresh.
systemctl disable --now loading-message-standalone.service 2>/dev/null || true
systemctl enable loading-message-standalone.service

# --------------------------------------------------------------------------
# 6. Pi-hole sanity check (informational only).
# --------------------------------------------------------------------------
echo
echo "==> Pi-hole status check (informational)"
if systemctl is-active --quiet pihole-FTL; then
  echo "    pihole-FTL: active"
else
  echo "    pihole-FTL: NOT active (was it ever installed here?)"
fi

echo
echo "================================================================"
echo "  done. reboot to launch the kiosk on tty1:"
echo "      sudo reboot"
echo
echo "  to test without rebooting:"
echo "      sudo systemctl start loading-message-standalone"
echo "      sudo journalctl -u loading-message-standalone -f"
echo "================================================================"
