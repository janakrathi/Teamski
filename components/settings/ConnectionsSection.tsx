"use client";

import { useCallback, useEffect, useState } from "react";

import { cachedJson, peekJson } from "@/lib/net/cache";


// ==========================================
// CONNECTIONS
// ==========================================
//
// Accounts the agent may act on. Distinct from
// signing in, which only proves who you are -
// this is standing permission to open your
// spreadsheet later, while you are not watching.
//
// So it says plainly which account is connected
// and exactly what the agent can do with it. A
// permission nobody can see is a permission
// nobody agreed to.
//

type Connection = {
  provider: string;
  account_email: string | null;
  scopes: string[];
  created_at: string;
};


type Provider = {
  id: string;
  label: string;
  blurb: string;

  // Some providers offer more than one grant.
  // GitHub's private access is read *and write*
  // on every private repo the person can reach,
  // so it is a separate, deliberate choice
  // rather than a default.
  options?: { label: string; query: string }[];

  can: string[];

  // Available, but only if the person opts in when
  // connecting (a wider grant). Shown apart from
  // "can" so it does not overstate the default, and
  // apart from "cannot" so it does not look
  // impossible.
  optional?: string[];

  // Worth as much space as what it can do. The
  // consent screen Google shows says what is
  // being granted; only this can say what is not.
  cannot: string[];
  mark: React.ReactNode;
};

const PROVIDERS: Provider[] = [
  {
    id: "google",
    label: "Google",

    blurb:
      "Google Sheets. Nothing else - Gmail and Drive search both need a paid annual security assessment from Google.",

    can: [
      "Read a spreadsheet you give it the link to",
      "Add rows to one, with your approval",
    ],

    cannot: [
      "See a list of your files",
      "Open a spreadsheet you have not given it",
      "Read your email",
    ],

    mark: (
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
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
    ),  },

  {
    id: "github",
    label: "GitHub",

    blurb:
      "Read code, search a repo, see issues. Public repositories unless you choose otherwise.",

    options: [
      { label: "Connect", query: "" },
      {
        label: "Include private",
        query: "?private=1",
      },
    ],

    can: [
      "Read a file from a repository",
      "Search a repository for code",
      "List issues and pull requests",
      "Open an issue, with your approval",
    ],

    optional: [
      'Read private repositories, if you connect with "Include private"',
    ],

    cannot: [
      "Push code or change a branch",
      "Act on repositories you cannot reach yourself",
    ],

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


function Tick() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="mt-[3px] h-3 w-3 shrink-0 text-emerald-400"
    >
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  );
}


function Cross() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      className="mt-[3px] h-3 w-3 shrink-0 text-[var(--text-faint)]"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}


// For something available only if you opt in when
// connecting: not on by default, but not impossible
// either.

function Plus() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      className="mt-[3px] h-3 w-3 shrink-0 text-amber-300"
    >
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}


const CONNECTIONS_URL = "/api/connections";


export default function ConnectionsSection() {
  // What the cache already holds, so reopening this tab
  // shows the connections at once instead of "Loading…".
  const known = peekJson<{
    connections?: Connection[];
    available?: string[];
  }>(CONNECTIONS_URL);

  const [connections, setConnections] = useState<
    Connection[]
  >(known?.connections ?? []);

  // Providers this server can actually offer.
  // Without a client id and secret in the
  // environment, connecting is impossible and
  // the button would only lie.

  const [available, setAvailable] = useState<
    string[]
  >(known?.available ?? []);

  const [loading, setLoading] = useState(!known);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");


  // `force` re-reads past the cache, after a change.
  const load = useCallback(async (force = false) => {
    try {
      const data = (await cachedJson(
        CONNECTIONS_URL,
        { force }
      )) as {
        error?: string;
        connections?: Connection[];
        available?: string[];
        needsMigration?: boolean;
      };

      if (data.error) {
        throw new Error(data.error);
      }

      setConnections(data.connections ?? []);
      setAvailable(data.available ?? []);

      if (data.needsMigration) {
        setError(
          "Run supabase/migrations/0012_connections.sql to enable connections."
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not load connections."
      );
    } finally {
      setLoading(false);
    }
  }, []);


  useEffect(() => {
    // Off the effect body, so the first load does
    // not land as a second render pass.

    void Promise.resolve().then(() => load());
  }, [load]);


  async function disconnect(provider: string) {
    setBusy(provider);
    setError("");

    try {
      const response = await fetch(
        `/api/connections?provider=${provider}`,
        { method: "DELETE" }
      );

      if (!response.ok) {
        const data = await response.json();

        throw new Error(
          data.error || "Could not disconnect."
        );
      }

      await load(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not disconnect."
      );
    } finally {
      setBusy("");
    }
  }


  if (loading) {
    return (
      <p className="text-[12.5px] text-[var(--text-faint)]">
        Loading connections…
      </p>
    );
  }


  return (
    <div className="space-y-3">
      {PROVIDERS.map((provider) => {
        const connection = connections.find(
          (item) =>
            item.provider === provider.id
        );

        const offered = available.includes(
          provider.id
        );

        return (
          <div
            key={provider.id}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] p-3.5"
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5">
                {provider.mark}
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-[var(--text)]">
                  {provider.label}
                </p>

                <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--text-faint)]">
                  {connection
                    ? connection.account_email ??
                      "Connected"
                    : provider.blurb}
                </p>
              </div>

              {connection ? (
                <button
                  type="button"
                  disabled={busy === provider.id}
                  onClick={() =>
                    disconnect(provider.id)
                  }
                  className="shrink-0 rounded-md border border-[var(--border-strong)] px-2.5 py-1 text-[11.5px] text-[var(--text-muted)] transition hover:border-red-900/60 hover:text-red-200 disabled:opacity-40"
                >
                  Disconnect
                </button>
              ) : (
                // A real link, because connecting
                // leaves this app for Google and
                // comes back. Routing it through
                // the client router would only get
                // in the way.

                offered ? (
                  <span className="flex shrink-0 gap-1.5">
                    {(
                      provider.options ?? [
                        { label: "Connect", query: "" },
                      ]
                    ).map((option, index) => (
                      <a
                        key={option.label}
                        href={`/api/connections/${provider.id}${option.query}`}
                        className={
                          index === 0
                            ? "rounded-md bg-[var(--accent)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--bg)] transition hover:opacity-90"
                            : "rounded-md border border-[var(--border-strong)] px-2.5 py-1 text-[11.5px] text-[var(--text-muted)] transition hover:text-[var(--text)]"
                        }
                      >
                        {option.label}
                      </a>
                    ))}
                  </span>
                ) : (
                  <span
                    title={`Add ${provider.id.toUpperCase()}_CLIENT_ID and ${provider.id.toUpperCase()}_CLIENT_SECRET to .env.local`}
                    className="shrink-0 cursor-not-allowed rounded-md border border-dashed border-[var(--border-strong)] px-2.5 py-1 text-[11.5px] text-[var(--text-faint)]"
                  >
                    Not configured
                  </span>
                )
              )}
            </div>


            {/* ------------------------ */}
            {/* WHAT IT CAN DO           */}
            {/* ------------------------ */}
            {/*                          */}
            {/* Shown whether or not it  */}
            {/* is connected: before, so */}
            {/* the choice is informed;  */}
            {/* after, so it stays       */}
            {/* visible.                 */}

            {/* A tick against a cross, not two  */}
            {/* dots. Two lists of grey text with */}
            {/* near-identical bullets said       */}
            {/* nothing, and made the whole card  */}
            {/* look switched off. The shape      */}
            {/* carries the meaning; the colour   */}
            {/* only reinforces it.               */}

            <ul className="mt-3 space-y-1.5 border-t border-[var(--border)] pt-2.5">
              {provider.can.map((line) => (
                <li
                  key={line}
                  className="flex items-start gap-2 text-[11.5px] leading-relaxed text-[var(--text)]"
                >
                  <Tick />

                  <span>{line}</span>
                </li>
              ))}

              {provider.optional?.map((line) => (
                <li
                  key={line}
                  className="flex items-start gap-2 text-[11.5px] leading-relaxed text-[var(--text-muted)]"
                >
                  <Plus />

                  <span>{line}</span>
                </li>
              ))}

              {provider.cannot.map((line) => (
                <li
                  key={line}
                  className="flex items-start gap-2 text-[11.5px] leading-relaxed text-[var(--text-faint)]"
                >
                  <Cross />

                  <span>{line}</span>
                </li>
              ))}
            </ul>

            {connection && (
              <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--text-faint)]">
                Disconnecting removes the token
                from this app. To revoke it at
                {" "}
                {provider.label} as well, use that
                account&apos;s own permissions
                page.
              </p>
            )}
          </div>
        );
      })}

      {error && (
        <p className="rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-[12px] leading-relaxed text-red-200">
          {error}
        </p>
      )}

      <p className="pt-1 text-[11.5px] leading-relaxed text-[var(--text-faint)]">
        A connection is yours alone. Teammates in
        your projects cannot use it, and the
        agent only reaches an account on behalf
        of the person who connected it.
      </p>
    </div>
  );
}
