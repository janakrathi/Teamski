"use client";

import { useEffect, useRef, useState } from "react";


// ==========================================
// SIGN IN WITH GOOGLE, ON TEAMSKI'S OWN PAGE
// ==========================================
//
// The usual flow sends people to Google and back
// through Supabase, so Google's screen says
// "to continue to <project>.supabase.co" - a name
// nobody signing up for Teamski recognises.
//
// Google's own sign-in button runs on this page
// instead. Google hands the page an ID token, and
// Supabase signs the person in with it, so Google
// names teamski.in rather than Supabase. Nothing
// about the account changes: it is the same Google
// sign-in, the same Supabase user.
//
// The token is bound to a one-time value (a nonce)
// made here: Google signs its hash into the token,
// and Supabase checks the original against it, so a
// token lifted from somewhere else cannot be
// replayed.
//
// If Google's script cannot load - blocked, offline
// - the caller falls back to the redirect button.
//
// Google draws its button inside its own frame, in
// its own style, which sat oddly beside the other
// two. So the page draws a button that matches, and
// Google's real button is laid exactly over it,
// nearly transparent. What people see says what
// happens - "Continue with Google" - and the click
// still lands on Google's button, which is the only
// thing Google will accept a sign-in from.
//

type Credential = { credential: string };

type Gis = {
  accounts: {
    id: {
      initialize: (options: Record<string, unknown>) => void;
      renderButton: (
        element: HTMLElement,
        options: Record<string, unknown>
      ) => void;
      cancel: () => void;
    };
  };
};

declare global {
  interface Window {
    google?: Gis;
  }
}

const SCRIPT = "https://accounts.google.com/gsi/client";

let loading: Promise<Gis> | null = null;


function loadGis(): Promise<Gis> {
  if (window.google?.accounts?.id) {
    return Promise.resolve(window.google);
  }

  if (loading) {
    return loading;
  }

  loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");

    script.src = SCRIPT;
    script.async = true;

    script.onload = () =>
      window.google?.accounts?.id
        ? resolve(window.google)
        : reject(new Error("Google sign-in did not start."));

    script.onerror = () => {
      loading = null;
      reject(new Error("Google sign-in could not load."));
    };

    document.head.appendChild(script);
  });

  return loading;
}


async function makeNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));

  const raw = btoa(String.fromCharCode(...bytes))
    .replace(/[+/=]/g, "");

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(raw)
  );

  const hashed = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return { raw, hashed };
}


export default function GoogleSignIn({
  clientId,
  disabled,
  onToken,
  onUnavailable,
  children,
  className,
}: {
  clientId: string;
  disabled: boolean;

  // What the button looks like: the same icon and
  // label as the other sign-in buttons.
  children: React.ReactNode;
  className: string;

  // Given the ID token and the nonce it was made
  // with. Resolves once the person is signed in, or
  // rejects with a message to show.
  onToken: (token: string, nonce: string) => Promise<void>;

  onUnavailable: () => void;
}) {
  const slot = useRef<HTMLDivElement>(null);

  // A new nonce every time the button is set up,
  // including after a failed attempt.

  const [round, setRound] = useState(0);

  const [working, setWorking] = useState(false);

  const [ready, setReady] = useState(false);

  const handlers = useRef({ onToken, onUnavailable });

  // Back to this page from memory, part way through
  // a sign-in: not signing in any more. A fresh
  // nonce too, since the old one may have been
  // handed to Google already.

  useEffect(() => {
    function shownAgain(event: PageTransitionEvent) {
      if (event.persisted) {
        setWorking(false);
        setRound((n) => n + 1);
      }
    }

    window.addEventListener("pageshow", shownAgain);

    return () => window.removeEventListener("pageshow", shownAgain);
  }, []);

  useEffect(() => {
    handlers.current = { onToken, onUnavailable };
  });

  useEffect(() => {
    let cancelled = false;

    Promise.all([loadGis(), makeNonce()])
      .then(([gis, nonce]) => {
        if (cancelled || !slot.current) {
          return;
        }

        gis.accounts.id.initialize({
          client_id: clientId,
          nonce: nonce.hashed,
          ux_mode: "popup",
          auto_select: false,
          cancel_on_tap_outside: true,
          itp_support: true,
          use_fedcm_for_button: true,

          callback: (response: Credential) => {
            if (!response?.credential) {
              return;
            }

            setWorking(true);

            handlers.current
              .onToken(response.credential, nonce.raw)
              .catch(() => {
                // The caller has shown why. A fresh
                // nonce for the next try.
                setWorking(false);
                setRound((n) => n + 1);
              });
          },
        });

        slot.current.innerHTML = "";

        gis.accounts.id.renderButton(slot.current, {
          type: "standard",
          theme: "filled_black",
          size: "large",
          text: "continue_with",
          shape: "rectangular",
          logo_alignment: "center",
          width: Math.min(400, slot.current.offsetWidth || 360),
        });

        setReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          handlers.current.onUnavailable();
        }
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, round]);

  const blocked = disabled || working || !ready;

  return (
    <div className="group relative">
      {/* What people see. */}

      <div
        aria-hidden="true"
        className={`${className} ${disabled || working ? "opacity-50" : ""} group-hover:border-[var(--border-strong)] group-hover:bg-[var(--bg-hover)] group-focus-within:border-[var(--border-strong)]`}
      >
        {working ? <span>Signing you in…</span> : children}
      </div>

      {/* What they click: Google's own button, laid
          over the one above. */}

      <div
        ref={slot}
        aria-label="Continue with Google"
        className={`absolute inset-0 flex items-center justify-center overflow-hidden opacity-[0.01] ${
          blocked ? "pointer-events-none" : ""
        }`}
      />
    </div>
  );
}
