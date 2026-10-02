"use client";

import Logo from "@/components/ui/Logo";

import GoogleSignIn from "@/components/auth/GoogleSignIn";

import {
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  useRouter,
  useSearchParams,
} from "next/navigation";

import { createClient } from "@/lib/supabase/client";

import { emailAlreadyUsed } from "@/lib/auth/signup";


// ==========================================
// SIGNING IN
// ==========================================
//
// The first thing anyone sees, so it is built
// out of the same surface as the rest of the app
// rather than a white box bolted to the front of
// it.
//
// Two ways in. A provider, which is one click
// and no password to lose, or an email and a
// password for people who would rather not
// involve anyone else.
//


// ------------------------------------------
// PROVIDERS
// ------------------------------------------
//
// Three, on purpose. Between them they cover
// almost everyone who signs in to a work tool,
// and each was free to set up.
//
// Apple, Facebook and phone were built and then
// taken out again: Apple wants 99 dollars a year,
// Facebook wants business verification and a
// review before anyone outside the team can use
// it, and every SMS costs money and invites
// pumping fraud. None were going to be switched
// on, and a login page should not carry buttons
// nobody can press. They are in the git history
// if that ever changes.
//

type Provider = {
  // Supabase's own name for it, which is not
  // always the brand name: Microsoft is "azure".
  id: "google" | "azure" | "github";

  label: string;
  mark: React.ReactNode;
};

const PROVIDERS: Provider[] = [
  {
    id: "google",
    label: "Google",

    mark: (
      <svg
        viewBox="0 0 24 24"
        className="h-[15px] w-[15px]"
        aria-hidden="true"
      >
        <path
          fill="#4285F4"
          d="M23.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.63v3h3.87c2.26-2.09 3.56-5.17 3.56-8.87Z"
        />
        <path
          fill="#34A853"
          d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.87-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.28v3.09A12 12 0 0 0 12 24Z"
        />
        <path
          fill="#FBBC05"
          d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56V6.63H1.28a12 12 0 0 0 0 10.74l4-3.09Z"
        />
        <path
          fill="#EA4335"
          d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.63l4 3.09C6.22 6.86 8.87 4.75 12 4.75Z"
        />
      </svg>
    ),
  },

  {
    id: "azure",
    label: "Microsoft",

    mark: (
      <svg
        viewBox="0 0 24 24"
        className="h-[15px] w-[15px]"
        aria-hidden="true"
      >
        <path fill="#F25022" d="M1 1h10.2v10.2H1z" />
        <path fill="#7FBA00" d="M12.8 1H23v10.2H12.8z" />
        <path fill="#00A4EF" d="M1 12.8h10.2V23H1z" />
        <path fill="#FFB900" d="M12.8 12.8H23V23H12.8z" />
      </svg>
    ),
  },

  {
    id: "github",
    label: "GitHub",

    mark: (
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.5 3.17-1.18 3.17-1.18.63 1.59.24 2.76.12 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.4-5.26 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.2.67.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z" />
      </svg>
    ),
  },
];


const DORMANT_LABELS: Record<string, string> = {
  google: "Google",
  azure: "Microsoft",
  github: "GitHub",
};


// ------------------------------------------
// FIELD
// ------------------------------------------

export function Field({
  label,
  ...input
}: {
  label: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] tracking-[0.06em] text-[var(--text-faint)] uppercase">
        {label}
      </span>

      <input
        {...input}
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2.5 text-[13.5px] text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--border-strong)]"
      />
    </label>
  );
}


type WaysIn = {
  // Decided on the server, so the page arrives
  // already correct. Working it out in the
  // browser meant every visit flashed buttons
  // that then disappeared.
  providers: string[];

  // Built but not switched on in the Supabase
  // dashboard. Empty in production, and empty
  // here too while all three are enabled; it
  // exists so that turning one off does not look
  // like code that was never written.
  dormant?: string[];

  // True when this workspace has a key for a
  // hosted model, which makes the local claim a
  // choice rather than a fact.
  hostedAvailable?: boolean;

  // When set, Google sign-in uses Google's own
  // button on this page, so Google's screen names
  // teamski.in instead of Supabase.
  googleClientId?: string | null;
};


// useSearchParams needs a boundary above it, and
// the fallback is a plain dark page so nothing
// flashes a different colour first.

export default function LoginForm(ways: WaysIn) {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[var(--bg)]" />
      }
    >
      <Form {...ways} />
    </Suspense>
  );
}


function Form({
  providers,
  dormant = [],
  hostedAvailable = false,
  googleClientId = null,
}: WaysIn) {
  const router = useRouter();

  const params = useSearchParams();

  const supabase = createClient();

  // Only ever a path on this site. The gate puts
  // it here when it turns someone away from a
  // page they asked for.

  const wanted = params.get("next");

  const next =
    wanted &&
    wanted.startsWith("/") &&
    !wanted.startsWith("//")
      ? wanted
      : "/";

  const offered = PROVIDERS.filter((provider) =>
    providers.includes(provider.id)
  );

  // Nothing here works until React has attached
  // its handlers. On localhost that gap is
  // invisible; over a slow link it is seconds, and
  // the page looks completely ready throughout.
  //
  // Clicking Sign in during that window submitted
  // the form the browser's own way - a plain GET
  // to /login? with no fields, since the inputs
  // are controlled and carry no name - which
  // silently reloaded the page and looked exactly
  // like a failed login. The provider buttons were
  // just as dead.
  //
  // So the controls say so until they can act.

  // false while rendering on the server and
  // through hydration, true once React owns the
  // page. Nothing to subscribe to, so the
  // subscribe function does nothing.

  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  // "Get started" on the front page arrives with
  // mode=signup, and should not land on a sign-in
  // form it then has to switch away from.

  const [signingUp, setSigningUp] =
    useState(params.get("mode") === "signup");

  // Asking for a reset link instead of signing in.
  const [resetting, setResetting] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [busy, setBusy] = useState<string | null>(
    null
  );

  // ----------------------------------------
  // COMING BACK FROM AN UNFINISHED SIGN-IN
  // ----------------------------------------
  //
  // Choosing Google or GitHub marks the page busy
  // and leaves for that site. Abandon it there and
  // press Back, and the browser can hand back this
  // very page from memory - still busy, every
  // button still disabled - so signing in with a
  // password did nothing at all.
  //
  // So a page that is shown again forgets any
  // sign-in that was on its way out, and a
  // provider that is pending never blocks the
  // password form in the first place.

  const leftAt = useRef(0);

  useEffect(() => {
    function forget() {
      setBusy((current) => (current === "email" ? current : null));
    }

    function shownAgain(event: PageTransitionEvent) {
      if (event.persisted) {
        forget();
      }
    }

    // A redirect that never happened - a popup
    // blocked, the tab switched away and back -
    // comes back as the tab being visible again.

    function visibleAgain() {
      if (document.visibilityState === "hidden") {
        leftAt.current = Date.now();

        return;
      }

      if (leftAt.current && Date.now() - leftAt.current > 1500) {
        forget();
      }
    }

    window.addEventListener("pageshow", shownAgain);
    document.addEventListener("visibilitychange", visibleAgain);

    return () => {
      window.removeEventListener("pageshow", shownAgain);
      document.removeEventListener("visibilitychange", visibleAgain);
    };
  }, []);

  const [note, setNote] = useState("");

  // Signing up with an address that already has an
  // account. Its own message, because the way out is a
  // button - sign in instead - not more typing.
  const [emailTaken, setEmailTaken] = useState(false);

  // A provider can refuse before there is ever a
  // session, and it says why in the URL.

  const [error, setError] = useState(
    params.get("error") ?? ""
  );

  // Google's script can be blocked or offline. Then
  // the ordinary redirect button stands in for it.

  const [googleButtonFailed, setGoogleButtonFailed] =
    useState(false);

  const useGoogleButton =
    Boolean(googleClientId) && !googleButtonFailed;


  async function withGoogleToken(
    token: string,
    nonce: string
  ) {
    setError("");

    const { error } =
      await supabase.auth.signInWithIdToken({
        provider: "google",
        token,
        nonce,
      });

    if (error) {
      setError(
        /audience|client/i.test(error.message)
          ? "Google sign-in is not set up for this site yet. Use another way in for now."
          : error.message
      );

      throw error;
    }

    router.push(next);
    router.refresh();
  }


  async function withProvider(
    provider: Provider["id"]
  ) {
    setBusy(provider);
    setError("");

    const { error } =
      await supabase.auth.signInWithOAuth({
        provider,

        options: {
          redirectTo: `${
            window.location.origin
          }/auth/callback?next=${encodeURIComponent(
            next
          )}`,
        },
      });

    // Success navigates away, so still being
    // here means it did not.

    if (error) {
      setError(
        error.message.includes("not enabled")
          ? `${provider} sign in is not switched on for this workspace yet.`
          : error.message
      );

      setBusy(null);
    }
  }


  async function withPassword(
    event: React.FormEvent
  ) {
    event.preventDefault();

    setBusy("email");
    setError("");
    setNote("");
    setEmailTaken(false);

    // ----------------------------------------
    // FORGOT PASSWORD
    // ----------------------------------------
    //
    // Supabase emails a link that comes back
    // through /auth/callback, which signs the
    // person in, then on to /reset-password to
    // choose a new one.
    //
    // The answer is the same whether or not the
    // address has an account, so this form cannot
    // be used to find out who has signed up.

    if (resetting) {
      const { error } =
        await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(
            "/reset-password"
          )}`,
        });

      setBusy(null);

      if (error) {
        setError(
          /rate|seconds|too many/i.test(error.message)
            ? "A link was sent a moment ago. Wait a minute before asking for another."
            : error.message
        );

        return;
      }

      setNote(
        "If there is a Teamski account for that email, a link to choose a new password is on its way. Open it in this browser. Check spam if it has not arrived in a few minutes."
      );

      return;
    }

    if (signingUp) {
      const { data, error } =
        await supabase.auth.signUp({
          email,
          password,

          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });

      // A taken address - see lib/auth/signup.ts for
      // the two ways Supabase says so.
      if (emailAlreadyUsed({ data, error })) {
        setEmailTaken(true);
        setBusy(null);

        return;
      }

      if (error) {
        setError(error.message);
        setBusy(null);

        return;
      }

      // No session back means the project asks
      // people to confirm their address first.

      if (!data.session) {
        setNote(
          "Check your email to confirm the account, then sign in."
        );

        setBusy(null);

        return;
      }
    } else {
      const { error } =
        await supabase.auth.signInWithPassword({
          email,
          password,
        });

      if (error) {
        setError(error.message);
        setBusy(null);

        return;
      }
    }

    router.push(next);
    router.refresh();
  }


  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-6 py-12">
      <div className="w-full max-w-[360px]">

        {/* ---------------------------- */}
        {/* MASTHEAD                     */}
        {/* ---------------------------- */}

        <div className="mb-8 text-center">
          <Logo size={64} className="mx-auto mb-4" />

          <h1 className="text-[19px] font-medium tracking-[-0.01em] text-[var(--text)]">
            Teamski
          </h1>

          <p className="mt-1.5 text-[13px] text-[var(--text-muted)]">
            {resetting
              ? "Enter your email and we will send you a link to choose a new password."
              : signingUp
                ? "Create an account to get started."
                : "Sign in to your workspace."}
          </p>
        </div>


        {/* ---------------------------- */}
        {/* PROVIDERS                    */}
        {/* ---------------------------- */}

        {!resetting && (
        <div className="space-y-2">
          {offered.map((provider) =>
            provider.id === "google" && useGoogleButton ? (
              <GoogleSignIn
                key="google"
                clientId={googleClientId!}
                disabled={!ready || busy === "email"}
                onToken={withGoogleToken}
                onUnavailable={() => setGoogleButtonFailed(true)}
                className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2.5 text-[13.5px] text-[var(--text)] transition"
              >
                {provider.mark}

                <span>Continue with {provider.label}</span>
              </GoogleSignIn>
            ) : (
            <button
              key={provider.id}
              type="button"
              disabled={!ready || busy === "email"}
              onClick={() =>
                withProvider(provider.id)
              }
              className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2.5 text-[13.5px] text-[var(--text)] transition hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
            >
              {provider.mark}

              <span>
                {busy === provider.id
                  ? "Opening…"
                  : `Continue with ${provider.label}`}
              </span>
            </button>
            )
          )}
        </div>
        )}


        {/* ---------------------------- */}
        {/* BUILT, NOT SWITCHED ON       */}
        {/* ---------------------------- */}

        {!resetting && dormant.length > 0 && (
          <div className="mt-2 space-y-2">
            {dormant.map((name) => (
              <div
                key={name}
                title="Switch it on in the Supabase dashboard: Authentication -> Providers"
                className="flex w-full cursor-not-allowed items-center justify-center gap-2.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-2.5 text-[13.5px] text-[var(--text-faint)]"
              >
                <span>
                  Continue with{" "}
                  {DORMANT_LABELS[name] ?? name}
                </span>

                <span className="text-[11px]">
                  not enabled
                </span>
              </div>
            ))}

            <p className="px-2 pt-1.5 text-center text-[11.5px] leading-relaxed text-[var(--text-faint)]">
              Only you see these. Turn them on in
              the Supabase dashboard under
              Authentication → Providers and they
              become real buttons.
            </p>
          </div>
        )}


        {/* Nothing to divide when email is */}
        {/* the only way in.                */}

        {!resetting &&
          (offered.length > 0 ||
          dormant.length > 0) && (
          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-[var(--border)]" />

            <span className="text-[11px] text-[var(--text-faint)]">
              or
            </span>

            <div className="h-px flex-1 bg-[var(--border)]" />
          </div>
        )}


        {/* ---------------------------- */}
        {/* EMAIL                        */}
        {/* ---------------------------- */}

        <form
          onSubmit={withPassword}
          className="space-y-3"
        >
          <Field
            label="Email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setEmailTaken(false);
            }}
          />

          {!resetting && (
            <div>
              <Field
                label="Password"
                type="password"
                required
                minLength={6}
                autoComplete={
                  signingUp
                    ? "new-password"
                    : "current-password"
                }
                placeholder="Your password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
              />

              {!signingUp && (
                <div className="mt-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setResetting(true);
                      setError("");
                      setNote("");
                    }}
                    className="text-[12px] text-[var(--text-muted)] underline-offset-2 transition hover:text-[var(--text)] hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={!ready || busy === "email"}
            className="w-full rounded-lg bg-[var(--accent)] px-3 py-2.5 text-[13.5px] font-medium text-[var(--bg)] transition hover:opacity-90 disabled:opacity-50"
          >
            {!ready
              ? "Loading…"
              : resetting
                ? busy === "email"
                  ? "Sending…"
                  : "Send reset link"
              : busy === "email"
                ? signingUp
                  ? "Creating account…"
                  : "Signing in…"
                : signingUp
                  ? "Create account"
                  : "Sign in"}
          </button>
        </form>


        {/* ---------------------------- */}
        {/* WHAT HAPPENED                */}
        {/* ---------------------------- */}

        {error && (
          <p className="mt-4 rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2.5 text-[12.5px] leading-relaxed text-red-200">
            {error}
          </p>
        )}

        {emailTaken && (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2.5 text-[12.5px] leading-relaxed text-red-300"
          >
            Email already in use.{" "}
            <button
              type="button"
              onClick={() => {
                // Same address and password carried over,
                // so it is one press of Sign in from here.
                setSigningUp(false);
                setEmailTaken(false);
                setError("");
                setNote("");
              }}
              className="font-medium text-red-200 underline underline-offset-2 transition hover:text-white"
            >
              Log in
            </button>{" "}
            instead. If you signed up with Google, use Continue with Google.
          </p>
        )}

        {note && (
          <p className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2.5 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
            {note}
          </p>
        )}


        {/* ---------------------------- */}
        {/* THE OTHER MODE               */}
        {/* ---------------------------- */}

        <p className="mt-6 text-center text-[12.5px] text-[var(--text-muted)]">
          {resetting
            ? "Remembered it?"
            : signingUp
              ? "Already have an account?"
              : "No account yet?"}{" "}

          <button
            type="button"
            onClick={() => {
              if (resetting) {
                setResetting(false);
              } else {
                setSigningUp(!signingUp);
              }

              setError("");
              setNote("");
              setEmailTaken(false);
            }}
            className="text-[var(--text)] underline underline-offset-2 transition hover:text-[var(--accent)]"
          >
            {resetting || signingUp ? "Sign in" : "Create one"}
          </button>
        </p>

        {/* Scoped to the model on purpose. The */}
        {/* line here used to read "nothing you  */}
        {/* write here leaves the machine",      */}
        {/* which a packet capture disproves in  */}
        {/* a second: every message, attachment  */}
        {/* and memory is written to hosted      */}
        {/* Postgres. What is genuinely true is  */}
        {/* the interesting half - the thinking  */}
        {/* happens here, and no AI provider is  */}
        {/* ever handed the conversation.        */}
        {/*                                      */}
        {/* Anything absolute on this page has   */}
        {/* to survive somebody checking.        */}
        {/*                                      */}
        {/* Hosted on teamski.in, "your own      */}
        {/* hardware" stopped being true - it is */}
        {/* ours - and a team that adds its own  */}
        {/* Claude key does send chats to        */}
        {/* Anthropic. So both lines say whose.  */}

        <p className="mt-8 text-center text-[11.5px] leading-relaxed text-[var(--text-faint)]">
          {hostedAvailable
            ? "Built-in AI runs on Teamski's servers, or through Anthropic and OpenAI for stronger models."
            : "Built-in AI runs on Teamski's own servers. Chats only reach an AI provider if your team connects one."}
        </p>

        <p className="mt-3 text-center text-[11.5px] text-[var(--text-faint)]">
          <a href="/privacy" className="hover:text-[var(--text-muted)]">
            Privacy Policy
          </a>
          {" · "}
          <a href="/terms" className="hover:text-[var(--text-muted)]">
            Terms of Service
          </a>
        </p>
      </div>
    </main>
  );
}
