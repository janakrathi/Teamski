"use client";

import { useEffect, useState } from "react";


// ==========================================
// CONNECT YOUR OWN IMAGE KEY (CLOUDFLARE)
// ==========================================
//
// Teamski has no shared image key: images are made
// only on a person's own free Cloudflare account +
// token. Cloudflare needs two things (an account id
// and a token), so it is a step longer than the Groq
// one.
//
// Triggered whenever a person asks for an image (a
// window event the chat fires) without a key
// connected. Skipping it once does not silence it:
// without a key there is no image, so the next ask
// offers it again.
//

const CF_DASH_URL = "https://dash.cloudflare.com/";


export default function ConnectCloudflare() {
  const [show, setShow] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    async function onImageWanted() {
      try {
        const response = await fetch(
          "/api/image-key",
          { cache: "no-store" }
        );

        const data = await response.json();

        if (!data.connected) {
          setShow(true);
        }
      } catch {
        // If we cannot tell, do not nag.
      }
    }

    window.addEventListener(
      "teamski:image-wanted",
      onImageWanted
    );

    return () =>
      window.removeEventListener(
        "teamski:image-wanted",
        onImageWanted
      );
  }, []);


  function dismiss() {
    setShow(false);
  }


  async function connect() {
    if (!accountId.trim() || !token.trim() || busy) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const response = await fetch(
        "/api/image-key",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            accountId: accountId.trim(),
            token: token.trim(),
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setError(
          data.error ||
            "Those credentials did not work."
        );
        return;
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
      <div className="t-modal w-full max-w-[440px] rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-panel)] p-6 shadow-2xl shadow-black/50">
        {done ? (
          <>
            <h2 className="text-[18px] font-semibold text-[var(--text)]">
              Connected ⚡
            </h2>

            <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
              Your images now run on your own Cloudflare
              account, on your own daily limit.
            </p>

            <button
              type="button"
              onClick={() => setShow(false)}
              className="mt-5 w-full rounded-lg bg-[var(--accent)] px-4 py-2 text-[13.5px] font-medium text-[var(--bg)] transition hover:opacity-90"
            >
              Done
            </button>
          </>
        ) : (
          <>
            <h2 className="text-[18px] font-semibold text-[var(--text)]">
              Images need your own free key
            </h2>

            <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
              Teamski makes images on your own Cloudflare
              account — free, no card, about 95 images a
              day. Setting it up takes about three
              minutes.
            </p>

            <ol className="mt-4 space-y-3">
              <li className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--bg-raised)] text-[11px] font-semibold text-[var(--text-muted)]">
                  1
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-[var(--text)]">
                    Open Cloudflare (free signup)
                  </p>

                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--text-faint)]">
                    Go to Workers &amp; Pages — your{" "}
                    <strong>Account ID</strong> is on
                    the right. Then Profile → API
                    Tokens → Create Token → the{" "}
                    <strong>Workers AI</strong>{" "}
                    template.
                  </p>

                  <a
                    href={CF_DASH_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--text)] transition hover:bg-[var(--bg-hover)]"
                  >
                    Open Cloudflare
                    <span aria-hidden="true">↗</span>
                  </a>
                </div>
              </li>

              <li className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--bg-raised)] text-[11px] font-semibold text-[var(--text-muted)]">
                  2
                </span>

                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-[13px] text-[var(--text)]">
                    Paste both here
                  </p>

                  <input
                    type="text"
                    value={accountId}
                    disabled={busy}
                    onChange={(event) =>
                      setAccountId(event.target.value)
                    }
                    placeholder="Account ID"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2 font-mono text-[12.5px] text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--border-strong)]"
                  />

                  <input
                    type="text"
                    value={token}
                    disabled={busy}
                    onChange={(event) =>
                      setToken(event.target.value)
                    }
                    placeholder="API token"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2 font-mono text-[12.5px] text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--border-strong)]"
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
              disabled={
                busy ||
                !accountId.trim() ||
                !token.trim()
              }
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
              Not now — no images until it is connected
            </button>
          </>
        )}
      </div>
    </div>
  );
}
