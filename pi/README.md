# pi/ — The Loading Message kiosk

A Raspberry Pi Zero W running Raspberry Pi OS Lite, booting straight into
Chromium kiosk mode showing the offline build of `web/`. Fully offline:
percentage is computed from the local clock, ciphertext lives on the SD card,
decryption happens in the browser via WebCrypto, and the message **loops**
forever once the target moment arrives (because a kiosk has no refresh button).

Designed to coexist with **Pi-hole** on the same Pi. The installer never
touches lighttpd, dnsmasq, port 80, or any networking config.

## Architecture

```
dev machine                         pi (offline)
-----------                         -----------
web/  ──build:offline──▶  pi/dist/  ──rsync──▶  /opt/loading-message/web/
                            +                       │
                            config.json (secret)    │
                            message.json            │
                                                    ▼
                                            chromium --kiosk file://…
```

- `OfflineCounter.tsx` reads `./config.json` + `./message.json` via `fetch()`
  under `file://` (Chromium is launched with `--allow-file-access-from-files`).
- The plaintext is held in a component-local ref. Never written to
  `localStorage`, `document.title`, or any global.
- After reveal, the message fades out, pauses 5 s, and replays from the top.

## Preview locally (dev machine)

One command — builds the offline bundle, encrypts a throwaway test message,
points the target date a few seconds into the future, and serves it on
`http://localhost:8765`:

```bash
./pi/test-local.sh           # reveal in 20s (default)
./pi/test-local.sh 5         # reveal in 5s
./pi/test-local.sh 0         # already revealed, jump straight to the loop
./pi/test-local.sh 30 "your own test message"
```

The percentage climbs, the message reveals at the target moment, fades, and
loops forever. Ctrl-C to stop. Uses a throwaway secret — your real
`SECRET_KEY` is never touched.

## Build the bundle (dev machine)

```bash
cd pi
./build.sh
cp dist/config.example.json dist/config.json
$EDITOR dist/config.json   # set startDate, targetDate, secret
```

`dist/` is git-ignored.

`build.sh` runs `npm run build:offline` in `web/`, copies the result and
`api/message.json` into `pi/dist/`, and grep-scans the bundled JS for
secret-shaped strings as a leak guard.

## Install on the Pi (preserves Pi-hole)

Fresh Raspberry Pi OS Lite, Pi-hole already installed, SSH key access set up.

```bash
# from the dev machine, ship the bundle
rsync -a pi/dist/ pi@<pi-host>:/tmp/loading-message-dist/
rsync -a pi/install.sh pi/files/ pi@<pi-host>:/tmp/loading-message-installer/

# on the pi
ssh pi@<pi-host>
sudo /tmp/loading-message-installer/install.sh /tmp/loading-message-dist
sudo reboot
```

The installer:

1. `apt-get install --no-install-recommends xserver-xorg x11-xserver-utils
   xinit chromium-browser unclutter rsync` — no desktop, no display manager.
2. rsyncs the bundle to `/opt/loading-message/web/` and `chmod 600`s
   `config.json` (owned by `pi`).
3. Drops `/home/pi/.bash_profile` (auto-`startx` on tty1) and
   `/home/pi/.xinitrc` (chromium kiosk).
4. Adds a `getty@tty1` drop-in for autologin as `pi`. Pi-hole's units are
   untouched.

After `sudo reboot` the Pi comes up directly into fullscreen Chromium showing
the percentage.

## Where the secret lives

`/opt/loading-message/web/config.json`, `chmod 600`, owned by `pi`.

```json
{
  "startDate": "2026-01-01T00:00:00Z",
  "targetDate": "2226-01-01T00:00:00Z",
  "encryptDate": "2226-01-01",
  "secret": "the-real-key"
}
```

Anyone with physical access to the SD card can extract this file. The kiosk
threat model assumes the Pi is sealed inside the artwork enclosure.

## Lockdown

- Set a strong password for `pi`, disable password SSH (`PasswordAuthentication no`),
  keep only your key.
- Optional: `sudo raspi-config` → "Performance Options" → enable read-only
  root (`overlayfs`). Test Pi-hole still works after — Pi-hole writes to
  `/etc/pihole`, which needs to be excluded from the overlay or moved to a
  writable partition. Do this **after** you've verified the kiosk boots.
- Optional: `xmodmap -e "keycode 9 ="` in `.xinitrc` to disable Escape if you
  want extra paranoia. Chromium kiosk already blocks `Ctrl+W` / `Alt+F4`.

## Clock caveat

The Pi Zero W has no RTC and (in this setup) no internet, so it cannot reach
NTP. Standalone mode trusts the system clock — a wrong clock means a wrong
unlock date. Add a DS3231 hardware RTC and configure `hwclock` /
`fake-hwclock` to honour it if you care about hitting the target moment
correctly years from now.

## Files

```
pi/
├── test-local.sh                  # dev-machine: one-shot local preview
├── build.sh                       # dev-machine: build pi/dist/
├── install.sh                     # on the pi: deploy + configure kiosk
├── files/
│   ├── bash_profile               # → /home/pi/.bash_profile
│   ├── xinitrc                    # → /home/pi/.xinitrc
│   └── getty-autologin.conf       # → /etc/systemd/system/getty@tty1.service.d/
├── dist/                          # git-ignored, produced by build.sh
└── README.md
```
