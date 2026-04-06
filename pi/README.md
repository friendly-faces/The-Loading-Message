# pi/ — The Loading Message terminal client

A single Python script that turns a Raspberry Pi (or any Linux box with a TTY)
into a dedicated display for The Loading Message. It has two modes, selected
by the `LOADING_MESSAGE_MODE` environment variable.

## Mode 1 — networked (default)

- Polls the Go API (`LOADING_MESSAGE_API_URL`) every 10 s.
- Interpolates the percentage smoothly between polls.
- No local ciphertext, no local secret. The Pi is a dumb display — the API
  decides when to unlock and hands over the plaintext at that moment.
- **Pure Python stdlib.** No `pip install` required.

## Mode 2 — standalone (offline)

- Fully offline. No network calls at all. Good for an air-gapped Pi or a
  location with no connectivity.
- Reads the encrypted message from a local file (`MESSAGE_PATH`).
- Reads `START_DATE`, `TARGET_DATE`, `SECRET_KEY` (and optionally
  `ENCRYPT_DATE`) from the environment.
- Computes the percentage locally on every frame from the Pi's clock.
- Decrypts the message in-process the moment `now >= TARGET_DATE`, using the
  same AES-256-GCM / pbkdf2-sha256 scheme as the Go API.
- **Requires the `cryptography` package.** (Stdlib has pbkdf2 but no AES,
  so there's no way around one external dep in this mode.)

  ```bash
  pip3 install -r pi/requirements.txt
  ```

  Protect the Pi the way you'd protect any box that holds a secret: SSH-only
  access, disabled HDMI input if you like, screen-locking, etc.

## Install on a Raspberry Pi

These steps are shared by both modes.

```bash
sudo mkdir -p /opt/loading-message
sudo cp loading_message.py /opt/loading-message/

# Free tty1 so the service owns it.
sudo systemctl disable --now getty@tty1.service
sudo systemctl set-default multi-user.target
```

### Networked mode

```bash
sudo cp loading-message.service /etc/systemd/system/loading-message.service
sudo systemctl daemon-reload
sudo systemctl enable --now loading-message.service
```

Override defaults by adding a drop-in:

```bash
sudo systemctl edit loading-message.service
```

```ini
[Service]
Environment=LOADING_MESSAGE_API_URL=https://api.theloadingmessage.com/
Environment=LOADING_MESSAGE_POLL_INTERVAL=10
```

### Standalone mode

```bash
# Ciphertext on the Pi (the same api/message.json that ships in the Docker image)
sudo cp ../api/message.json /opt/loading-message/message.json
sudo chown pi:pi /opt/loading-message/message.json
sudo chmod 0640 /opt/loading-message/message.json

# Install the crypto dep
sudo pip3 install -r requirements.txt

# Secret lives in a protected env file, NOT the repo.
sudo mkdir -p /etc/loading-message
sudo tee /etc/loading-message/env > /dev/null <<'EOF'
LOADING_MESSAGE_MODE=standalone
MESSAGE_PATH=/opt/loading-message/message.json
START_DATE=YYYY-MM-DD
TARGET_DATE=YYYY-MM-DDTHH:MM:SSZ
SECRET_KEY=your-real-secret-key
# Optional — defaults to TARGET_DATE formatted YYYY-MM-DD:
# ENCRYPT_DATE=YYYY-MM-DD
EOF
sudo chmod 0600 /etc/loading-message/env
sudo chown root:root /etc/loading-message/env

sudo cp loading-message-standalone.service /etc/systemd/system/loading-message-standalone.service
sudo systemctl daemon-reload
sudo systemctl enable --now loading-message-standalone.service
```

Reboot — the Pi comes up straight into the percentage, fullscreen, no
desktop, no login prompt.

> **Clock caveat.** Standalone mode trusts the Pi's system clock. A Pi with
> no network cannot talk to NTP, so if you care about unlocking at a
> specific moment years from now, add a hardware RTC (e.g. DS3231) and make
> sure `fake-hwclock`/`hwclock` is configured to honour it. A wrong clock
> means a wrong unlock date.

## Configure

Anything in the script can be overridden via environment:

| Variable | Default | Mode | Purpose |
| --- | --- | --- | --- |
| `LOADING_MESSAGE_MODE` | `networked` | both | `networked` or `standalone` |
| `LOADING_MESSAGE_API_URL` | `https://api.theloadingmessage.com/` | networked | API root |
| `LOADING_MESSAGE_POLL_INTERVAL` | `10` | networked | seconds between polls |
| `MESSAGE_PATH` | `/opt/loading-message/message.json` | standalone | encrypted JSON file |
| `START_DATE` | (required) | standalone | YYYY-MM-DD or RFC 3339 |
| `TARGET_DATE` | (required) | standalone | unlock moment |
| `ENCRYPT_DATE` | = `TARGET_DATE` as YYYY-MM-DD | standalone | KDF passphrase date |
| `SECRET_KEY` | (required) | standalone | the real secret |

The animation constants (`WORD_DELAY`, `PARAGRAPH_PAUSE`, `BLINK_INTERVAL`)
are still source-level — edit `loading_message.py` if you want to tune them.

