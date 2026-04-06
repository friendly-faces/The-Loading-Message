import { useEffect, useRef, useState } from 'preact/hooks';

type ApiResponse = {
  percentage: number;
  locked: boolean;
  message: string | null;
};

type Props = {
  apiUrl: string;
};

const POLL_INTERVAL_MS = 1000;

function formatPercentage(pct: number): string {
  if (pct <= 0) return '0';
  return pct.toFixed(8);
}

function setFavicon(revealed: boolean) {
  const color = revealed ? 'white' : '%23111';
  const svg = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="${color}"/></svg>`;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    document.head.appendChild(link);
  }
  link.href = svg;
}

export default function Counter({ apiUrl }: Props) {
  const [pct, setPct] = useState<number | null>(null);
  const [locked, setLocked] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [hidePercentage, setHidePercentage] = useState(false);
  const [signalLost, setSignalLost] = useState(false);
  const failCountRef = useRef(0);
  const textboxRef = useRef<HTMLDivElement>(null);
  // Fire-once flag for the reveal. A ref instead of state so flipping it
  // doesn't trigger a re-render, which would re-run this effect and tear
  // down every timer we just scheduled via the cleanup function.
  const revealStartedRef = useRef(false);

  // Poll the API.
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(apiUrl, { cache: 'no-store' });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data: ApiResponse = await res.json();
        if (cancelled) return;
        failCountRef.current = 0;
        setSignalLost(false);
        setPct(data.percentage);
        setLocked(data.locked);
        if (data.message) setMessage(data.message);
      } catch {
        if (cancelled) return;
        failCountRef.current += 1;
        // Show "waiting for signal" only after 3 consecutive failures, so a
        // single flaky poll doesn't flash the message.
        if (failCountRef.current >= 3) setSignalLost(true);
      }
    }

    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [apiUrl]);

  // Keep document title + favicon in sync with current percentage + lock state.
  useEffect(() => {
    if (pct == null) return;
    const revealedWithMessage = !locked && !!message;
    if (revealedWithMessage) {
      document.title = 'The Message';
    } else {
      document.title = `${formatPercentage(pct)}% — The Loading Message`;
    }
    setFavicon(revealedWithMessage);
  }, [pct, locked, message]);

  // Reveal orchestrator — runs exactly once when !locked && message arrives.
  // All DOM mutations on the message box happen imperatively through the ref.
  // The message div is conditionally rendered with NO JSX-level style, so
  // subsequent re-renders (from 1 s polling) can't clobber the effect's work.
  useEffect(() => {
    if (locked || !message || revealStartedRef.current) return;
    revealStartedRef.current = true;

    const timers: number[] = [];

    // Fade the counter out; unmount it once the transition finishes so the
    // message can take its place in the centered layout.
    timers.push(window.setTimeout(() => setHidePercentage(true), 1500));

    // Begin the reveal a bit after the counter is gone.
    const startDelay = 2500;

    const paragraphs = message.trim().split(/\n\n+/).map((p) => {
      type Token = { type: 'word'; text: string } | { type: 'break' };
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

    function showParagraph() {
      const textbox = textboxRef.current;
      if (!textbox) return;
      if (pi >= paragraphs.length) return;

      const tokens = paragraphs[pi];
      textbox.innerHTML = '';
      textbox.style.transition = 'none';
      textbox.style.opacity = '1';

      let i = 0;
      function addToken() {
        const tb = textboxRef.current;
        if (!tb) return;
        if (i >= tokens.length) {
          const holdTime = pi >= paragraphs.length - 1 ? 3000 : 1500;
          timers.push(
            window.setTimeout(() => {
              const tb2 = textboxRef.current;
              if (!tb2) return;
              tb2.style.transition = 'opacity 1.5s ease-out';
              tb2.style.opacity = '0';
              timers.push(
                window.setTimeout(() => {
                  pi++;
                  if (pi < paragraphs.length) showParagraph();
                }, 1800),
              );
            }, holdTime),
          );
          return;
        }

        const token = tokens[i];
        if (token.type === 'break') {
          tb.appendChild(document.createElement('br'));
          i++;
          timers.push(window.setTimeout(addToken, 600));
          return;
        }

        const span = document.createElement('span');
        const prev = i > 0 ? tokens[i - 1] : null;
        span.textContent = (prev && prev.type !== 'break' ? ' ' : '') + token.text;
        tb.appendChild(span);
        requestAnimationFrame(() => {
          span.style.opacity = '1';
        });

        let delay = 300 + token.text.length * 15;
        const last = token.text.slice(-1);
        if ('.?!'.includes(last)) delay += 500;
        else if (',;'.includes(last)) delay += 250;
        else if ('—:'.includes(last)) delay += 200;

        i++;
        timers.push(window.setTimeout(addToken, delay));
      }
      addToken();
    }

    timers.push(window.setTimeout(showParagraph, startDelay));

    return () => {
      timers.forEach(clearTimeout);
    };
  }, [locked, message]);

  const revealing = !locked && !!message;

  return (
    <div class="container">
      {signalLost && !revealing && (
        <div class="signal-lost">— waiting for signal —</div>
      )}
      {pct != null && !hidePercentage && !signalLost && (
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
