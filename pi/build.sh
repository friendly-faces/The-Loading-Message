#!/usr/bin/env bash
# Build the offline kiosk bundle. Run on the dev machine, then copy pi/dist/
# (with a real config.json) to the Pi and run install.sh there.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/.." && pwd)"
web="$repo/web"
dist="$here/dist"

echo "==> building web/ in offline mode"
( cd "$web" && npm run build:offline )

echo "==> staging $dist"
mkdir -p "$dist"
# Copy build output but DO NOT clobber an existing config.json (it has the
# real secret).
rsync -a --exclude config.json "$web/dist/" "$dist/"

echo "==> copying ciphertext"
cp "$repo/api/message.json" "$dist/message.json"

if [ ! -f "$dist/config.example.json" ]; then
  cat > "$dist/config.example.json" <<'EOF'
{
  "startDate": "2026-01-01T00:00:00Z",
  "targetDate": "2226-01-01T00:00:00Z",
  "encryptDate": "2226-01-01",
  "secret": "REPLACE_ME"
}
EOF
fi

echo "==> leak guard: scanning bundle for secrets"
if grep -RIn --include='*.js' --include='*.html' \
     -e 'REPLACE_ME' -e '"secret"' "$dist" \
     | grep -v 'config.example.json' \
     | grep -v 'config.json'; then
  echo "FAIL: bundle appears to contain secret material" >&2
  exit 1
fi

echo
echo "Done. Next steps:"
echo "  1. cp $dist/config.example.json $dist/config.json"
echo "  2. edit $dist/config.json with the real SECRET_KEY and dates"
echo "  3. rsync -a $dist/ pi@<pi-host>:/tmp/loading-message-dist/"
echo "  4. ssh pi@<pi-host>; cd /tmp/loading-message-dist && sudo /path/to/pi/install.sh /tmp/loading-message-dist"
