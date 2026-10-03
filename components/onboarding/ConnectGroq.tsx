"use client";

import { useEffect, useState } from "react";


// ==========================================
// CONNECT YOUR OWN GROQ KEY
// ==========================================
//
// Teamski works out of the box on a shared AI key,
// but that key is finite and shared by everyone. A
// person's own free Groq key gives them their own
// daily limit and a faster experience - so this
// walks a non-technical person through getting one
// and pasting it, in two clicks.
//
// Shown once. Dismissing it (or connecting) means it
// does not come back; the shared key keeps working
// either way.
//

const DISMISS_KEY = "groqKeyPromptDismissed";

const GROQ_KEYS_URL = "https://console.groq.com/keys";


export default function ConnectGroq({
  enabled,
}: {
  // The parent only turns this on for an existing
  // user who is past first-run setup.
  enabled: boolean;
}) {
  const [show, setShow] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  // After mount only, so nothing depends on
  // localStorage or the network during the first
  // render.
  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        if (
          localStorage.getItem(DISMISS_KEY) === "1"
        ) {
          return;
        }
      } catch {
        // No storage: fall through and let the
        // already-connected check decide.
      }

      // Already brought a Groq key? Nothing to ask.
      try {
        const response = await fetch(
          "/api/models/keys",
          { cache: "no-store" }
        );

        const data = await response.json();

        const hasGroq = (
          data.connected as
            | { service: string }[]
            | undefined
        )?.some(
          (entry) => entry.service === "groq"
        );

        if (!cancelled && !hasGroq) {
          setShow(true);
        }
      } catch {
        // If we cannot tell, do not nag.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);


  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Fine - it just may ask again next time.
    }

    setShow(false);
  }


  async function connect() {
    const value = key.trim();

    if (!value || busy) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const response = await fetch(
        "/api/models/keys",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            service: "groq",
            key: value,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setError(
          data.error ||
            "That key did not work. Copy it again from Groq."
        );
        return;
      }

      try {
        localStorage.setItem(DISMISS_KEY, "1");
      } catch {
        // Fine.
      }

      setDone(true);
    } catch {
      setError(
        "Could not reach the server. Try again in a moment."
      );
    } finally {
      setBusy(false);
    }
  }


  if (!show) {
    return null;
  }


  return (
    <div className="t-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="t-modal w-full max-w-[420px] rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-panel)] p-6 shadow-2xl shadow-black/50">
        {done ? (
          <>
            <h2 className="text-[18px] font-semibold text-[var(--text)]">
              Connected ⚡
            </h2>

            <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
              Your AI now runs on your own Groq key —
              faster, and on your own daily limit.
            </p>

            <button
              type="button"
              onClick={() => {
                setShow(false);
                // Reload so the model list picks up
                // the new key cleanly.
                window.location.reload();
              }}
              className="mt-5 w-full rounded-lg bg-[var(--accent)] px-4 py-2 text-[13.5px] font-medium text-[var(--bg)] transition hover:opacity-90"
            >
              Done
            </button>
          </>
        ) : (
          <>
            <h2 className="text-[18px] font-semibold text-[var(--text)]">
              Make your AI faster — it&apos;s free
            </h2>

            <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
              Teamski works right now on a shared AI
              key. Connect your own free Groq key for a
              faster model on your own daily limit —
              about two minutes.
            </p>

            <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--text-faint)]">
              Image generation uses a separate free key
              — we&apos;ll help you add that the first
              time you make an image.
            </p>

            <ol className="mt-4 space-y-3">
              <li className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--bg-raised)] text-[11px] font-semibold text-[var(--text-muted)]">
                  1
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-[var(--text)]">
                    Get your free key
                  </p>

                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--text-faint)]">
                    Sign in with Google, click
                    &ldquo;Create API Key&rdquo;, and
                    copy it (it starts with{" "}
                    <span className="font-mono">
                      gsk_
                    </span>
                    ).
                  </p>

                  <a
                    href={GROQ_KEYS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--text)] transition hover:bg-[var(--bg-hover)]"
                  >
                    Open Groq to get a key
                    <span aria-hidden="true">↗</span>
                  </a>
                </div>
              </li>

              <li className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--bg-raised)] text-[11px] font-semibold text-[var(--text-muted)]">
                  2
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-[var(--text)]">
                    Paste it here
                  </p>

                  <input
                    type="text"
                    value={key}
                    disabled={busy}
                    onChange={(event) =>
                      setKey(event.target.value)
                    }
                    placeholder="gsk_…"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2 font-mono text-[12.5px] text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--border-strong)]"
                  />
                </div>
              </li>
            </ol>

            {error && (
              <p className="mt-3 rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-[12px] leading-relaxed text-red-200">
                {error}
              </p>
            )}

            <button
              type="button"
              disabled={busy || !key.trim()}
              onClick={connect}
              className="mt-4 w-full rounded-lg bg-[var(--accent)] px-4 py-2 text-[13.5px] font-medium text-[var(--bg)] transition hover:opacity-90 disabled:opacity-40"
            >
              {busy ? "Connecting…" : "Connect"}
            </button>

            <button
              type="button"
              onClick={dismiss}
              className="mt-2 w-full rounded-lg px-4 py-2 text-[12.5px] text-[var(--text-faint)] transition hover:text-[var(--text-muted)]"
            >
              Maybe later — keep using the shared AI
            </button>
          </>
        )}
      </div>
    </div>
  );
}
