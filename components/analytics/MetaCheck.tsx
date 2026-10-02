"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

import { metaLoaded, whenMetaLoaded } from "@/lib/analytics/meta";


// ==========================================
// IS META SEEING THIS DEVICE?
// ==========================================
//
// A plain status page for the founder, opened on a phone
// or laptop: does Meta's script load here, is someone
// signed in, is the account new enough to count as a
// signup, and has the signup event gone out from this
// browser. Nothing is sent from here; it only looks.
//

type Row = { label: string; value: string; ok: boolean | null };

const DAY = 24 * 60 * 60 * 1000;


function age(ms: number) {
  const minutes = Math.round(ms / 60_000);

  if (minutes < 60) return `${minutes} min`;

  const hours = Math.round(minutes / 60);

  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`;
}


export default function MetaCheck() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const loaded = metaLoaded() || (await whenMetaLoaded(10_000));

      const { data } = await createClient().auth.getSession();
      const user = data.session?.user ?? null;
      const created = user ? Date.parse(user.created_at ?? "") : NaN;
      const fresh = Boolean(user) && Date.now() - created <= DAY;

      const flag = (copy: string) => {
        try {
          return user
            ? localStorage.getItem(`meta:registered:${copy}:${user.id}`) === "1"
            : false;
        } catch {
          return false;
        }
      };

      const next: Row[] = [
        {
          label: "Meta's script on this device",
          value: loaded
            ? "Loaded - Meta can see this browser"
            : "Blocked - an ad blocker, private DNS or network is stopping it",
          ok: loaded,
        },
        {
          label: "Signed in",
          value: user ? user.email ?? "yes" : "No - sign in to check signup tracking",
          ok: Boolean(user),
        },
      ];

      if (user) {
        next.push(
          {
            label: "Account age",
            value: `${age(Date.now() - created)}${fresh ? " - counts as a new signup" : " - older than a day, not a new signup"}`,
            ok: fresh,
          },
          {
            label: "Signup sent from this browser",
            value: flag("browser") ? "Yes" : fresh ? "Not yet" : "Not applicable",
            ok: fresh ? flag("browser") : null,
          },
          {
            label: "Signup sent from our server",
            value: flag("server")
              ? "Yes"
              : fresh
                ? "Not yet - needs the Conversions API token on the server"
                : "Not applicable",
            ok: fresh ? flag("server") : null,
          }
        );
      }

      if (!cancelled) setRows(next);
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-[var(--bg)] px-6 py-12 text-[var(--text)]">
      <div className="mx-auto max-w-[520px]">
        <h1 className="text-[22px] font-semibold">Meta tracking check</h1>

        <p className="mt-2 text-[13.5px] text-[var(--text-muted)]">
          What Meta can see from this device. Nothing is sent from this page.
        </p>

        <div className="mt-6 divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
          {rows === null ? (
            <p className="px-4 py-4 text-[13.5px] text-[var(--text-muted)]">
              Checking… (up to 10 seconds)
            </p>
          ) : (
            rows.map((row) => (
              <div key={row.label} className="px-4 py-3.5">
                <p className="text-[12px] tracking-[0.06em] text-[var(--text-faint)] uppercase">
                  {row.label}
                </p>

                <p
                  className={`mt-1 text-[14px] ${
                    row.ok === true
                      ? "text-[var(--text)]"
                      : row.ok === false
                        ? "text-red-300"
                        : "text-[var(--text-muted)]"
                  }`}
                >
                  {row.ok === true ? "✓ " : row.ok === false ? "✕ " : ""}
                  {row.value}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
