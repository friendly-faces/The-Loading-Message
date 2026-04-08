# pi/ — The Loading Message standalone client

A single Python script that turns a Raspberry Pi (or any Linux box with a TTY)
into a dedicated display for The Loading Message. Renders fullscreen on
`/dev/tty1` via `curses`, no X server, no Chromium, no display manager. Light
enough for a Pi Zero 2 W. Designed to coexist with **Pi-hole** on the same Pi.

## Modes

- **standalone** (recommended for the kiosk) — fully offline. Reads
  `START_DATE`, `TARGET_DATE`, `SECRET_KEY` from `/etc/loading-message/env`,
  reads the encrypted message from `/opt/loading-message/message.json`,
  computes the percentage from the local clock every frame, decrypts the
  message in-process the moment `now >= TARGET_DATE`, and **loops** the
  reveal forever (a kiosk has no refresh button). Requires the `cryptography`
  package.
- **networked** (default if no env is set) — polls the public Go API every
  10 s, no local secret. Pure stdlib. Useful for testing on a connected box.

## One-shot install on the Pi

```bash
ssh pi@<pi-host>
git clone https://github.com/friendly-faces/The-Loading-Message.git ~/loading-message
cd ~/loading-message/pi

cp local.env.example local.env
$EDITOR local.env       # set SECRET_KEY, START_DATE, TARGET_DATE

sudo ./setup.sh
sudo reboot
```

After reboot the Pi boots straight into the percentage on tty1, fullscreen,
no login prompt, no desktop. `local.env` is git-ignored so the secret never
leaves the Pi.

`setup.sh` is **idempotent** and safe to re-run. It will:

1. Tear down any leftover Chromium kiosk junk from earlier experiments
   (`/home/pi/.bash_profile` startx hook, `/home/pi/.xinitrc`, the
   `getty@tty1` autologin drop-in, `/opt/loading-message/web`).
2. `apt-get install python3 python3-pip python3-cryptography` (no X, no
   Chromium, no display manager).
3. Copy `loading_message.py` and `api/message.json` to `/opt/loading-message/`.
4. Install `local.env` to `/etc/loading-message/env` as `root:root` `0600`.
5. Install + enable the `loading-message-standalone.service` systemd unit.
6. Disable `getty@tty1` so the service can own the TTY.
7. Print Pi-hole status as a sanity check (it should still be `active`).

The installer never touches Pi-hole's units, lighttpd, dnsmasq, or any
networking config.

## Preview locally (dev machine)

One command — encrypts a throwaway message with a throwaway key, sets the
target a few seconds in the future, and runs the script in your terminal:

```bash
./pi/test-local.sh           # reveal in 20s (default)
./pi/test-local.sh 5         # reveal in 5s
./pi/test-local.sh 0         # already revealed, jumps straight into the loop
./pi/test-local.sh 30 "your custom message"
```

The percentage climbs (with all 8 decimals visibly racing — the start date is
faked to 10 hours ago so the trailing digits actually move), the message
reveals at the target moment, holds, blanks, and loops forever. Ctrl-C to
stop. Your real `SECRET_KEY` is never touched.

Auto-installs the `cryptography` pip package the first time if it's missing.

## Where things live on the Pi

```
/opt/loading-message/loading_message.py   # the script
/opt/loading-message/message.json         # encrypted blob (api/message.json)
/etc/loading-message/env                  # secret + dates, root:root, 0600
/etc/systemd/system/loading-message-standalone.service
```

## Configure

Anything in the script can be overridden via the env file:

| Variable | Default | Mode | Purpose |
| --- | --- | --- | --- |
| `LOADING_MESSAGE_MODE` | `networked` | both | `networked` or `standalone` |
| `MESSAGE_PATH` | `/opt/loading-message/message.json` | standalone | encrypted JSON file |
| `START_DATE` | (required) | standalone | YYYY-MM-DD or RFC 3339 |
| `TARGET_DATE` | (required) | standalone | unlock moment |
| `ENCRYPT_DATE` | = `TARGET_DATE` as YYYY-MM-DD | standalone | KDF passphrase date |
| `SECRET_KEY` | (required) | standalone | the real secret |
| `LOADING_MESSAGE_API_URL` | `https://api.theloadingmessage.com/` | networked | API root |
| `LOADING_MESSAGE_POLL_INTERVAL` | `10` | networked | seconds between polls |

The animation constants (`WORD_DELAY`, `PARAGRAPH_PAUSE`, `END_HOLD`,
`LOOP_PAUSE`, `BLINK_INTERVAL`) are still source-level — edit
`loading_message.py` if you want to tune them.

## Lockdown

- Strong password for `pi`. Disable password SSH (`PasswordAuthentication no`),
  keep only your key.
- The service runs as the unprivileged `pi` user; the env file with the
  secret is `root:root 0600` and only sourced by systemd.
- Anyone with physical access to the SD card can extract the secret. Threat
  model assumes the Pi is sealed inside the artwork enclosure.

## Clock caveat

The Pi Zero 2 W has no RTC and (in this setup) no internet, so it cannot
reach NTP. Standalone mode trusts the system clock — a wrong clock means a
wrong unlock date. Add a DS3231 hardware RTC and configure
`hwclock` / `fake-hwclock` to honour it if you care about hitting the target
moment correctly years from now.

## Files

```
pi/
├── setup.sh                              # on the Pi: one-shot installer
├── test-local.sh                         # dev machine: local preview
├── loading_message.py                    # the client
├── loading-message.service               # networked-mode systemd unit
├── loading-message-standalone.service    # standalone-mode systemd unit
├── requirements.txt                      # cryptography (only for standalone)
├── local.env.example                     # copy to local.env, fill in
└── README.md
```
