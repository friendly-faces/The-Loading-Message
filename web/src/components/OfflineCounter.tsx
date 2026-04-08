import { useEffect, useRef, useState } from 'preact/hooks';
import { decryptMessage, type EncryptedBlob } from '../lib/decrypt';

// Offline kiosk counter. Computes the percentage from the local clock,
// decrypts the bundled message at the target moment, and loops the reveal
// forever (the kiosk can never be refreshed, so we can't end on a frozen
// final frame the way the public site does).

type Config = {
  startDate: string;
  targetDate: string;
  encryptDate?: string;
  secret: string;
};

const TICK_MS = 50;
const LOOP_PAUSE_MS = 5000;

function formatPercentage(pct: number): string {
  if (pct <= 0) return '0';
  return pct.toFixed(8);
}

export default function OfflineCounter() {
  const [pct, setPct] = useState<number | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [hidePercentage, setHidePercentage] = useState(false);
  const textboxRef = useRef<HTMLDivElement>(null);

  // Plaintext + config live in refs so they never end up on window, in
  // localStorage, or in the React tree as serializable state.
  const messageRef = useRef<string | null>(null);
  const startMsRef = useRef<number>(0);
  const targetMsRef = useRef<number>(0);
  // Anchor Date.now() to performance.now() once, then derive "now" from
  // performance.now() so we get sub-millisecond resolution. Without this the
  // last 4-5 digits of the percentage are stuck on zeros (Date.now() only
  // ticks every full ms).
  const epochAnchorRef = useRef<number>(0);
  const perfAnchorRef = useRef<number>(0);
  const loopTimersRef = useRef<number[]>([]);
  const loopActiveRef = useRef(false);

  // Tick: load config + ciphertext, then drive percentage from local clock.
  useEffect(() => {
    let cancelled = false;
    let intervalId: number | undefined;

    (async () => {
      // Relative URLs so this works under file:// and never reaches the network.
      const [cfgRes, msgRes] = await Promise.all([
        fetch('./config.json', { cache: 'no-store' }),
        fetch('./message.json', { cache: 'no-store' }),
      ]);
      if (cancelled) return;
      const cfg: Config = await cfgRes.json();
      const blob: EncryptedBlob = await msgRes.json();

      startMsRef.current = Date.parse(cfg.startDate);
      targetMsRef.current = Date.parse(cfg.targetDate);
      epochAnchorRef.current = Date.now();
      perfAnchorRef.current = performance.now();
      const encryptDate =
        cfg.encryptDate ?? cfg.targetDate.slice(0, 10);

      let unlocked = false;

      const tick = async () => {
        if (cancelled) return;
        const now =
          epochAnchorRef.current + (performance.now() - perfAnchorRef.current);
        const total = targetMsRef.current - startMsRef.current;
        let p = total > 0 ? ((now - startMsRef.current) / total) * 100 : 100;
        if (p < 0) p = 0;
        if (p > 100) p = 100;
        setPct(p);

        if (!unlocked && now >= targetMsRef.current) {
          unlocked = true;
          try {
            const plaintext = await decryptMessage(blob, cfg.secret, encryptDate);
            if (cancelled) return;
            messageRef.current = plaintext;
            // Drop the secret reference now that we're done with it.
            (cfg as { secret: string }).secret = '';
            if (intervalId !== undefined) {
              clearInterval(intervalId);
              intervalId = undefined;
            }
            startReveal();
          } catch {
            // If decryption fails, freeze on 100% rather than leaking anything.
            unlocked = false;
          }
        }
      };

      tick();
      intervalId = window.setInterval(tick, TICK_MS);
    })();

    return () => {
      cancelled = true;
      if (intervalId !== undefined) clearInterval(intervalId);
      loopTimersRef.current.forEach(clearTimeout);
      loopTimersRef.current = [];
    };
  }, []);

  // Reveal animation, looped forever. Adapted from Counter.tsx but ends with
  // a pause and a restart instead of holding the last paragraph.
  function startReveal() {
    if (loopActiveRef.current) return;
    loopActiveRef.current = true;

    setHidePercentage(false);
    setRevealing(true);

    // Fade out percentage, then begin the first reveal pass.
    loopTimersRef.current.push(
      window.setTimeout(() => setHidePercentage(true), 1500),
    );
    loopTimersRef.current.push(window.setTimeout(runRevealPass, 2500));
  }

  function runRevealPass() {
    const message = messageRef.current;
    const textbox = textboxRef.current;
    if (!message || !textbox) {
      // textbox not mounted yet — try again next frame.
      loopTimersRef.current.push(window.setTimeout(runRevealPass, 50));
      return;
    }

    type Token = { type: 'word'; text: string } | { type: 'break' };
    const paragraphs = message.trim().split(/\n\n+/).map((p) => {
      const tokens: Token[] = [];
      p.split(/\n/).forEach((line, li) => {
        if (li > 0) tokens.push({ type: 'break' });
        line
          .split(/\s+/)
          .filter(Boolean)
          .forEach((w) => tokens.push({ type: 'word', text: w }));
      });
      return tokens;
    });

    let pi = 0;

    const showParagraph = () => {
      const tb = textboxRef.current;
      if (!tb) return;
      if (pi >= paragraphs.length) {
        // Pause on black, then restart from the top.
        loopTimersRef.current.push(
          window.setTimeout(runRevealPass, LOOP_PAUSE_MS),
        );
        return;
      }

      const tokens = paragraphs[pi];
      tb.innerHTML = '';
      tb.style.transition = 'none';
      tb.style.opacity = '1';

      let i = 0;
      const addToken = () => {
        const tb2 = textboxRef.current;
        if (!tb2) return;
        if (i >= tokens.length) {
          const isLast = pi >= paragraphs.length - 1;
          const holdTime = isLast ? 3000 : 1500;
          loopTimersRef.current.push(
            window.setTimeout(() => {
              const tb3 = textboxRef.current;
              if (!tb3) return;
              tb3.style.transition = 'opacity 1.5s ease-out';
              tb3.style.opacity = '0';
              loopTimersRef.current.push(
                window.setTimeout(() => {
                  pi++;
                  showParagraph();
                }, 1800),
              );
            }, holdTime),
          );
          return;
        }

        const token = tokens[i];
        if (token.type === 'break') {
          tb2.appendChild(document.createElement('br'));
          i++;
          loopTimersRef.current.push(window.setTimeout(addToken, 600));
          return;
        }

        const span = document.createElement('span');
        const prev = i > 0 ? tokens[i - 1] : null;
        span.textContent = (prev && prev.type !== 'break' ? ' ' : '') + token.text;
        tb2.appendChild(span);
        requestAnimationFrame(() => {
          span.style.opacity = '1';
        });

        let delay = 300 + token.text.length * 15;
        const last = token.text.slice(-1);
        if ('.?!'.includes(last)) delay += 500;
        else if (',;'.includes(last)) delay += 250;
        else if ('—:'.includes(last)) delay += 200;

        i++;
        loopTimersRef.current.push(window.setTimeout(addToken, delay));
      };
      addToken();
    };

    showParagraph();
  }

  return (
    <div class="container">
      {pct != null && !hidePercentage && (
        <div
          class="percentage"
          style={
            revealing
              ? { transition: 'opacity 1.5s ease-out', opacity: 0 }
              : undefined
          }
        >
          {formatPercentage(pct)}%
        </div>
      )}
      {revealing && <div class="message" ref={textboxRef}></div>}
    </div>
  );
}
