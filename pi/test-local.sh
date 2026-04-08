#!/usr/bin/env bash
# One-shot local preview of the standalone python kiosk client.
#
#   ./pi/test-local.sh           # default: reveal in 20s
#   ./pi/test-local.sh 5         # reveal in 5s
#   ./pi/test-local.sh 0         # already revealed (loops immediately)
#   ./pi/test-local.sh 30 "your custom message"
#
# Encrypts a throwaway message with a throwaway key, sets START/TARGET dates
# in the env, and runs loading_message.py in standalone mode in your current
# terminal. Ctrl-C to stop.
set -euo pipefail

SECONDS_AHEAD="${1:-20}"
MESSAGE="${2:-This is a test of the loading message kiosk.

The percentage climbs from zero to one hundred. When it lands, this text appears, fades, and loops forever — because the kiosk has no refresh button.

Built offline. Decrypted in process. Looping for the rest of time.}"

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/.." && pwd)"

# cryptography is required for standalone mode. Make sure it's importable.
if ! python3 -c "import cryptography" >/dev/null 2>&1; then
  echo "==> installing 'cryptography' (one-time, user site)"
  python3 -m pip install --user --quiet cryptography
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

SECRET="preview-secret-$$"
TARGET_EPOCH=$(( $(date -u +%s) + SECONDS_AHEAD ))
TARGET_DATE=$(date -u -d "@$TARGET_EPOCH" +%Y-%m-%dT%H:%M:%SZ)
ENCRYPT_DATE=$(date -u -d "@$TARGET_EPOCH" +%Y-%m-%d)
# Long simulated span so the trailing decimals of the percentage actually
# move; the standalone source recomputes pct from the wall clock every frame.
START_DATE=$(date -u -d "10 hours ago" +%Y-%m-%dT%H:%M:%SZ)

echo "==> encrypting throwaway test message"
( cd "$repo" && SECRET_KEY="$SECRET" TARGET_DATE="$ENCRYPT_DATE" \
    OUTPUT="$tmp/message.json" \
    node scripts/encrypt.mjs "$MESSAGE" >/dev/null )

echo
echo "================================================================"
echo "  reveal in: ${SECONDS_AHEAD}s   (target: $TARGET_DATE)"
echo "  Ctrl-C to stop."
echo "================================================================"
sleep 1

LOADING_MESSAGE_MODE=standalone \
MESSAGE_PATH="$tmp/message.json" \
START_DATE="$START_DATE" \
TARGET_DATE="$TARGET_DATE" \
ENCRYPT_DATE="$ENCRYPT_DATE" \
SECRET_KEY="$SECRET" \
exec python3 "$here/loading_message.py"
