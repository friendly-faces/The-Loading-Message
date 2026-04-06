#!/usr/bin/env python3
"""
The Loading Message — Raspberry Pi terminal client.

Two modes, selected by LOADING_MESSAGE_MODE (default "networked"):

  networked   Fetches the Go API every POLL_INTERVAL seconds and smoothly
              interpolates the percentage between polls. Requires network.
              Uses only the Python standard library.

  standalone  Fully offline. Reads the encrypted message from MESSAGE_PATH,
              reads START_DATE / TARGET_DATE / SECRET_KEY (and optional
              ENCRYPT_DATE) from the environment, computes the percentage
              locally on every frame, and decrypts the message in-process
              when now >= TARGET_DATE. Requires the `cryptography` package
              (only external dependency, only loaded in this mode).

In both modes, when the message unlocks, the script clears the screen and
reveals it word-by-word with paragraph-aware pacing, then freezes forever.
"""

import curses
import hashlib
import json
import locale
import os
import sys
import textwrap
import time
import urllib.request
from datetime import datetime, timezone
from typing import List, Optional, Tuple

# Needed so curses.addstr() can render UTF-8 block characters from BIG_FONT.
locale.setlocale(locale.LC_ALL, "")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

MODE = os.environ.get("LOADING_MESSAGE_MODE", "networked").strip().lower()

# Networked mode
API_URL = os.environ.get("LOADING_MESSAGE_API_URL", "https://api.theloadingmessage.com/")
POLL_INTERVAL = float(os.environ.get("LOADING_MESSAGE_POLL_INTERVAL", "10"))
REQUEST_TIMEOUT = 5.0

# Standalone mode
MESSAGE_PATH = os.environ.get("MESSAGE_PATH", "/opt/loading-message/message.json")

# Display
FRAME_INTERVAL = 1.0 / 30.0   # 30 fps
BLINK_INTERVAL = 0.6          # seconds between underscore on/off

# Reveal animation
WORD_DELAY = 0.4              # seconds between words
PARAGRAPH_PAUSE = 1.5         # seconds of blank-line pause between paragraphs


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_date(raw: str) -> datetime:
    """Accept YYYY-MM-DD or ISO 8601 / RFC 3339 (with or without trailing Z)."""
    s = raw.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError as exc:
        raise ValueError(f"invalid date {raw!r}: {exc}") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _format_pct(pct: float) -> str:
    if pct <= 0:
        return "0"
    return f"{pct:.8f}"


def _center_at(stdscr, y_offset: int, text: str) -> None:
    h, w = stdscr.getmaxyx()
    row = h // 2 + y_offset
    col = max(0, (w - len(text)) // 2)
    # Clip to available width to avoid curses errors at screen edges.
    stdscr.addstr(row, col, text[: max(0, w - col - 1)])


# ---------------------------------------------------------------------------
# Block-art "big font" used to draw the percentage as 7-row tall glyphs.
# Each glyph is exactly 5 cols wide and 7 rows tall. Characters are rendered
# horizontally with a single blank column between them.
# ---------------------------------------------------------------------------

_BIG_ROWS = 7
_BIG_COLS = 5

BIG_FONT = {
    "0": [
        " ███ ",
        "█   █",
        "█  ██",
        "█ █ █",
        "██  █",
        "█   █",
        " ███ ",
    ],
    "1": [
        "  █  ",
        " ██  ",
        "  █  ",
        "  █  ",
        "  █  ",
        "  █  ",
        " ███ ",
    ],
    "2": [
        " ███ ",
        "█   █",
        "    █",
        "   █ ",
        "  █  ",
        " █   ",
        "█████",
    ],
    "3": [
        " ███ ",
        "█   █",
        "    █",
        "  ██ ",
        "    █",
        "█   █",
        " ███ ",
    ],
    "4": [
        "   █ ",
        "  ██ ",
        " █ █ ",
        "█  █ ",
        "█████",
        "   █ ",
        "   █ ",
    ],
    "5": [
        "█████",
        "█    ",
        "████ ",
        "    █",
        "    █",
        "█   █",
        " ███ ",
    ],
    "6": [
        "  ██ ",
        " █   ",
        "█    ",
        "████ ",
        "█   █",
        "█   █",
        " ███ ",
    ],
    "7": [
        "█████",
        "    █",
        "   █ ",
        "  █  ",
        " █   ",
        " █   ",
        " █   ",
    ],
    "8": [
        " ███ ",
        "█   █",
        "█   █",
        " ███ ",
        "█   █",
        "█   █",
        " ███ ",
    ],
    "9": [
        " ███ ",
        "█   █",
        "█   █",
        " ████",
        "    █",
        "   █ ",
        " ██  ",
    ],
    ".": [
        "     ",
        "     ",
        "     ",
        "     ",
        "     ",
        " ██  ",
        " ██  ",
    ],
    "%": [
        "██  █",
        "██ █ ",
        "   █ ",
        "  █  ",
        " █   ",
        "█  ██",
        "   ██",
    ],
    "_": [
        "     ",
        "     ",
        "     ",
        "     ",
        "     ",
        "     ",
        "█████",
    ],
    " ": [
        "     ",
        "     ",
        "     ",
        "     ",
        "     ",
        "     ",
        "     ",
    ],
}


def _render_big(text: str) -> List[str]:
    """Render `text` through BIG_FONT. Returns _BIG_ROWS strings, all the same width."""
    rows = ["" for _ in range(_BIG_ROWS)]
    for i, ch in enumerate(text):
        glyph = BIG_FONT.get(ch, BIG_FONT[" "])
        for r in range(_BIG_ROWS):
            if i > 0:
                rows[r] += " "
            rows[r] += glyph[r]
    return rows


def _draw_percentage(stdscr, pct: float, show_underscore: bool) -> None:
    stdscr.erase()
    # Trailing char toggles between "_" and " " for the blinking cursor. Both
    # glyphs are the same width, so the overall block stays centered.
    text = _format_pct(pct) + "%"
    text += "_" if show_underscore else " "

    h, w = stdscr.getmaxyx()
    big = _render_big(text)
    big_h = len(big)
    big_w = len(big[0]) if big else 0

    # Use the big font if the terminal has at least 1 column of margin on
    # each side and fits vertically. Otherwise fall back to plain text.
    if big_w + 2 <= w and big_h + 2 <= h:
        top = max(0, (h - big_h) // 2)
        left = max(0, (w - big_w) // 2)
        for r, row in enumerate(big):
            # Clip defensively in case the terminal was resized mid-frame.
            max_cols = max(0, w - left - 1)
            stdscr.addstr(top + r, left, row[:max_cols])
    else:
        _center_at(stdscr, 0, text)

    stdscr.refresh()


# ---------------------------------------------------------------------------
# Source protocol
# ---------------------------------------------------------------------------

class Source:
    """
    Provides (percentage, locked, message) state to the main loop. Subclasses
    own whatever state they need (polling cache, file handles, etc.).
    """

    def bootstrap(self, stdscr) -> None:
        """Block briefly during startup if needed (e.g. waiting for the network)."""

    def tick(self, now: float) -> None:
        """Called every frame. Poll, refresh caches, whatever."""

    def get_state(self, now: float) -> Tuple[float, bool, Optional[str]]:
        """
        Return (percentage, locked, message_or_none). `message` is non-None
        only once the source has successfully obtained the decrypted text.
        """
        raise NotImplementedError


# ---------------------------------------------------------------------------
# Networked source
# ---------------------------------------------------------------------------

class NetworkedSource(Source):
    def __init__(self) -> None:
        self._pct_anchor = 0.0
        self._t_anchor = time.monotonic()
        self._rate = 0.0  # % per second, learned from two samples
        self._locked = True
        self._message: Optional[str] = None
        self._next_poll_at = 0.0

    def _fetch(self) -> Optional[dict]:
        try:
            req = urllib.request.Request(API_URL, headers={"User-Agent": "tlm-pi/1.0"})
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception:
            return None

    def _apply_sample(self, sample: dict) -> None:
        t_now = time.monotonic()
        pct_new = float(sample["percentage"])
        dt = t_now - self._t_anchor
        if dt > 0 and self._next_poll_at > 0:
            self._rate = (pct_new - self._pct_anchor) / dt
        self._pct_anchor = pct_new
        self._t_anchor = t_now
        self._locked = bool(sample.get("locked", True))
        msg = sample.get("message")
        if msg:
            self._message = msg

    def bootstrap(self, stdscr) -> None:
        while True:
            sample = self._fetch()
            if sample is not None:
                self._apply_sample(sample)
                self._next_poll_at = time.monotonic() + POLL_INTERVAL
                return
            stdscr.erase()
            _center_at(stdscr, 0, "connecting…")
            stdscr.refresh()
            time.sleep(1.0)

    def tick(self, now: float) -> None:
        if now < self._next_poll_at:
            return
        sample = self._fetch()
        if sample is not None:
            self._apply_sample(sample)
        self._next_poll_at = now + POLL_INTERVAL

    def get_state(self, now: float) -> Tuple[float, bool, Optional[str]]:
        interpolated = self._pct_anchor + self._rate * (now - self._t_anchor)
        if interpolated < 0:
            interpolated = 0.0
        elif interpolated > 100:
            interpolated = 100.0
        return interpolated, self._locked, self._message


# ---------------------------------------------------------------------------
# Standalone source
# ---------------------------------------------------------------------------

class StandaloneSource(Source):
    def __init__(self) -> None:
        start_raw = os.environ.get("START_DATE")
        target_raw = os.environ.get("TARGET_DATE")
        secret = os.environ.get("SECRET_KEY")
        if not start_raw or not target_raw or not secret:
            raise SystemExit(
                "standalone mode requires START_DATE, TARGET_DATE and SECRET_KEY env vars"
            )

        self._start = _parse_date(start_raw)
        self._target = _parse_date(target_raw)
        if self._target <= self._start:
            raise SystemExit("TARGET_DATE must be after START_DATE")
        self._secret = secret

        encrypt_raw = os.environ.get("ENCRYPT_DATE")
        if encrypt_raw:
            # Keep the passphrase stable even if TARGET_DATE is non-midnight.
            self._encrypt_date_str = encrypt_raw.strip()
        else:
            self._encrypt_date_str = self._target.strftime("%Y-%m-%d")

        try:
            with open(MESSAGE_PATH, "r", encoding="utf-8") as f:
                blob = json.load(f)
        except OSError as exc:
            raise SystemExit(f"failed to read {MESSAGE_PATH}: {exc}") from exc
        except json.JSONDecodeError as exc:
            raise SystemExit(f"invalid JSON in {MESSAGE_PATH}: {exc}") from exc

        for field in ("iv", "tag", "data", "salt"):
            if field not in blob:
                raise SystemExit(f"{MESSAGE_PATH} missing field: {field}")
        self._blob = blob

        self._decrypted: Optional[str] = None
        self._decrypt_attempted = False

    def _compute_pct(self, now_dt: datetime) -> float:
        total = (self._target - self._start).total_seconds()
        if total <= 0:
            return 100.0
        elapsed = (now_dt - self._start).total_seconds()
        pct = (elapsed / total) * 100.0
        if pct < 0:
            return 0.0
        if pct >= 100:
            return 100.0
        return pct

    def _decrypt(self) -> Optional[str]:
        try:
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # noqa: WPS433
        except ImportError:
            print(
                "standalone mode requires the `cryptography` package.\n"
                "install with:  pip3 install cryptography\n"
                "(see pi/requirements.txt)",
                file=sys.stderr,
            )
            return None

        try:
            salt = bytes.fromhex(self._blob["salt"])
            iv = bytes.fromhex(self._blob["iv"])
            tag = bytes.fromhex(self._blob["tag"])
            data = bytes.fromhex(self._blob["data"])
        except ValueError as exc:
            print(f"malformed hex in {MESSAGE_PATH}: {exc}", file=sys.stderr)
            return None

        passphrase = (self._secret + self._encrypt_date_str).encode("utf-8")
        key = hashlib.pbkdf2_hmac("sha256", passphrase, salt, 100_000, 32)

        try:
            plaintext = AESGCM(key).decrypt(iv, data + tag, None)
        except Exception as exc:  # cryptography raises InvalidTag etc.
            print(f"decrypt failed: {exc}", file=sys.stderr)
            return None

        return plaintext.decode("utf-8")

    def get_state(self, now: float) -> Tuple[float, bool, Optional[str]]:
        now_dt = datetime.now(timezone.utc)
        pct = self._compute_pct(now_dt)
        locked = now_dt < self._target
        message: Optional[str] = None
        if not locked:
            if not self._decrypt_attempted:
                self._decrypt_attempted = True
                self._decrypted = self._decrypt()
            message = self._decrypted
        return pct, locked, message


# ---------------------------------------------------------------------------
# Main counter loop
# ---------------------------------------------------------------------------

def run_counter_loop(stdscr, source: Source) -> str:
    """
    Display the live percentage until the source reports locked=false with
    a successfully-obtained message. Returns the plaintext message.
    """
    curses.curs_set(0)
    stdscr.nodelay(True)
    stdscr.timeout(0)

    source.bootstrap(stdscr)

    blink_on = True
    next_blink_at = time.monotonic() + BLINK_INTERVAL

    while True:
        now = time.monotonic()
        source.tick(now)

        pct, locked, message = source.get_state(now)
        if not locked and message:
            return message

        if now >= next_blink_at:
            blink_on = not blink_on
            next_blink_at = now + BLINK_INTERVAL

        _draw_percentage(stdscr, pct, blink_on)
        time.sleep(FRAME_INTERVAL)


# ---------------------------------------------------------------------------
# Reveal animation
# ---------------------------------------------------------------------------

def _wrap_paragraph(text: str, width: int) -> list:
    """
    Wrap a paragraph to the given width, returning a list of lines. Collapses
    internal whitespace so single newlines inside a paragraph become spaces.
    """
    collapsed = " ".join(text.split())
    if not collapsed:
        return [""]
    return textwrap.wrap(collapsed, width=width) or [""]


def _print_wrapped_block(stdscr, lines: list) -> None:
    h, w = stdscr.getmaxyx()
    top = max(0, (h - len(lines)) // 2)
    stdscr.erase()
    for i, line in enumerate(lines):
        col = max(0, (w - len(line)) // 2)
        stdscr.addstr(top + i, col, line[: max(0, w - col - 1)])
    stdscr.refresh()


def reveal_message(stdscr, message: str) -> None:
    """
    Clear the screen, print the message word-by-word with WORD_DELAY between
    words. Paragraph breaks become PARAGRAPH_PAUSE blank-line pauses. After
    the final word, freeze forever.
    """
    curses.curs_set(0)
    stdscr.erase()
    stdscr.refresh()
    time.sleep(0.5)

    h, w = stdscr.getmaxyx()
    wrap_width = max(10, min(w - 4, 72))

    paragraphs_raw = [p for p in message.strip().split("\n\n") if p.strip()]

    rendered_paragraphs: list = []

    def compose_full_block(current_lines=None) -> list:
        block: list = []
        for i, para_lines in enumerate(rendered_paragraphs):
            if i > 0:
                block.append("")
            block.extend(para_lines)
        if current_lines is not None:
            if rendered_paragraphs:
                block.append("")
            block.extend(current_lines)
        return block

    for pi_idx, paragraph in enumerate(paragraphs_raw):
        current_words: list = []

        for word in paragraph.split():
            current_words.append(word)
            current_text = " ".join(current_words)
            current_lines = _wrap_paragraph(current_text, wrap_width)
            block = compose_full_block(current_lines)

            # On very small terminals, drop the oldest paragraph so the
            # reveal keeps working regardless of message length.
            while len(block) > max(1, h - 2) and rendered_paragraphs:
                rendered_paragraphs.pop(0)
                block = compose_full_block(current_lines)

            _print_wrapped_block(stdscr, block)
            time.sleep(WORD_DELAY)

        rendered_paragraphs.append(_wrap_paragraph(paragraph, wrap_width))

        if pi_idx < len(paragraphs_raw) - 1:
            time.sleep(PARAGRAPH_PAUSE)

    _print_wrapped_block(stdscr, compose_full_block())

    while True:
        time.sleep(3600)


# ---------------------------------------------------------------------------
# Entry
# ---------------------------------------------------------------------------

def _build_source() -> Source:
    if MODE == "networked":
        return NetworkedSource()
    if MODE == "standalone":
        return StandaloneSource()
    raise SystemExit(
        f"invalid LOADING_MESSAGE_MODE {MODE!r} (expected 'networked' or 'standalone')"
    )


def main(stdscr) -> None:
    curses.use_default_colors()
    try:
        curses.curs_set(0)
    except curses.error:
        pass

    source = _build_source()
    message = run_counter_loop(stdscr, source)
    reveal_message(stdscr, message)


if __name__ == "__main__":
    try:
        curses.wrapper(main)
    except KeyboardInterrupt:
        sys.exit(0)
