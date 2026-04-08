#!/usr/bin/env bash
# One-shot local preview of the offline kiosk build.
#
#   ./pi/test-local.sh           # default: reveal at +20s
#   ./pi/test-local.sh 5         # reveal in 5 seconds
#   ./pi/test-local.sh 0         # already revealed (loops immediately)
#   ./pi/test-local.sh 60 "my secret message here"
#
# Builds web/ in offline mode, encrypts a throwaway message, writes a
# config.json with a target N seconds in the future, and serves it on
# http://localhost:8765 .  Ctrl-C to stop.
set -euo pipefail

SECONDS_AHEAD="${1:-20}"
MESSAGE="${2:-This is a test of the loading message kiosk.

The percentage climbs from zero to one hundred. When it lands, this text appears, fades, and loops forever — because the kiosk has no refresh button.

Built offline. Decrypted in your browser. Looping for the rest of time.}"

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/.." && pwd)"
web="$repo/web"

# Make sure we're on a node version Astro accepts.
if [ -f "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
  nvm use 22 >/dev/null 2>&1 || true
fi

if ! command -v node >/dev/null || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 22 ]; then
  echo "need node >= 22 (try: nvm use 22)" >&2
  exit 1
fi

PM=pnpm
command -v pnpm >/dev/null || PM=npm

echo "==> building web/ in offline mode"
( cd "$web" && $PM run build:offline >/dev/null )

dist="$web/dist"

# Encrypt a throwaway message with a throwaway key, just for this preview.
SECRET="preview-secret-$$"
TARGET_EPOCH=$(( $(date -u +%s) + SECONDS_AHEAD ))
TARGET_DATE=$(date -u -d "@$TARGET_EPOCH" +%Y-%m-%dT%H:%M:%SZ)
ENCRYPT_DATE=$(date -u -d "@$TARGET_EPOCH" +%Y-%m-%d)
# Use a long simulated span (10 hours back) so the trailing decimals of the
# 8-digit percentage actually flicker. With a short span, ms resolution only
# moves the first few digits.
START_DATE=$(date -u -d "10 hours ago" +%Y-%m-%dT%H:%M:%SZ)

echo "==> encrypting throwaway test message"
( cd "$repo" && SECRET_KEY="$SECRET" TARGET_DATE="$ENCRYPT_DATE" \
    OUTPUT="$dist/message.json" \
    node scripts/encrypt.mjs "$MESSAGE" >/dev/null )

cat > "$dist/config.json" <<EOF
{
  "startDate": "$START_DATE",
  "targetDate": "$TARGET_DATE",
  "encryptDate": "$ENCRYPT_DATE",
  "secret": "$SECRET"
}
EOF

PORT=8765
URL="http://localhost:$PORT"

echo
echo "================================================================"
echo "  open: $URL"
echo "  reveal in: ${SECONDS_AHEAD}s   (target: $TARGET_DATE)"
echo "  Ctrl-C to stop."
echo "================================================================"
echo

# Try to auto-open in a browser (best effort, harmless if it fails).
( sleep 1 && (xdg-open "$URL" >/dev/null 2>&1 || true) ) &

cd "$dist" && exec python3 -m http.server "$PORT"
