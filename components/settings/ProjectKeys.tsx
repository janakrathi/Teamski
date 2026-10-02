"use client";

import { useCallback, useEffect, useState } from "react";


// ==========================================
// THE KEY THE PROJECT SHARES
// ==========================================
//
// Individual keys are right for a developer
// trying things out and wrong for a company: a
// design team will not each open an Anthropic
// account. Somebody buys one key, everyone in the
// project draws on it, and one bill arrives.
//
// Members may spend it and may not read it - the
// row is only ever read server side, and nothing
// here returns a token.
//

type Existing = {
  service: string;
  label: string;
  models: number;
  limit: number | null;
};

type Person = {
  name: string;
  usdLabel: string;
  onProjectKeyLabel: string;
  turns: number;
};

type Service = { id: string; label: string };


export default function ProjectKeys({
  projectId,
  onChanged,
  onUpgrade,
}: {
  projectId: string | null;
  onChanged?: () => void;
  onUpgrade?: () => void;
}) {
  const [keys, setKeys] = useState<Existing[]>([]);

  const [services, setServices] = useState<
    Service[]
  >([]);

  const [canManage, setCanManage] =
    useState(false);

  const [adding, setAdding] = useState<
    string | null
  >(null);

  const [key, setKey] = useState("");

  const [limit, setLimit] = useState("");

  // Where the money went this month. Shown to
  // everyone in the project, not just the owner -
  // somebody spending a colleague's money should
  // be able to see how much.

  const [people, setPeople] = useState<Person[]>(
    []
  );

  const [total, setTotal] = useState("");

  const [estimated, setEstimated] =
    useState(false);

  // Who spent what is a Team report.

  const [reportPlan, setReportPlan] = useState<
    string | null
  >(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Whether the owner's plan lets these keys be
  // used. Assumed until the server says.

  const [allowed, setAllowed] = useState(true);

  const [requiredPlan, setRequiredPlan] =
    useState("Team");


  const load = useCallback(async () => {
    if (!projectId) {
      return;
    }

    try {
      const response = await fetch(
        `/api/projects/${projectId}/model-keys`,
        { cache: "no-store" }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Could not load."
        );
      }

      setKeys(data.keys ?? []);
      setServices(data.services ?? []);
      setCanManage(Boolean(data.canManage));

      setAllowed(data.allowed !== false);

      setRequiredPlan(data.requiredPlan ?? "Team");

      const spend = await fetch(
        `/api/projects/${projectId}/spend`,
        { cache: "no-store" }
      ).then((response) => response.json());

      setPeople(spend.people ?? []);

      setReportPlan(
        spend.locked
          ? (spend.requiredPlan ?? "Team")
          : null
      );
      setTotal(spend.projectTotalLabel ?? "");
      setEstimated(
        Boolean(spend.someUnpriced)
      );

      if (data.needsMigration) {
        setError(
          "Run supabase/migrations/0016_shared_keys.sql to enable shared keys."
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not load shared keys."
      );
    }
  }, [projectId]);


  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);


  async function save(service: string) {
    setBusy(true);
    setError("");

    try {
      const response = await fetch(
        `/api/projects/${projectId}/model-keys`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            service,
            key,
            limit: limit.trim() || null,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Could not save that key."
        );
      }

      setAdding(null);
      setKey("");

      await load();

      onChanged?.();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save that key."
      );
    } finally {
      setBusy(false);
    }
  }


  async function remove(service: string) {
    setBusy(true);

    try {
      await fetch(
        `/api/projects/${projectId}/model-keys?service=${service}`,
        { method: "DELETE" }
      );

      await load();

      onChanged?.();
    } finally {
      setBusy(false);
    }
  }


  if (!projectId) {
    return null;
  }


  // Somebody who cannot manage these still needs
  // to know what the project pays for, since it
  // is what they will be spending.

  if (!canManage) {
    return (
      <div>
        {keys.length > 0 && !allowed ? (
          <p className="text-[11.5px] leading-relaxed text-[var(--text-faint)]">
            This project has a shared key, but it
            is paused: sharing keys is part of{" "}
            {requiredPlan}, and the project
            owner&apos;s plan does not include it.
          </p>
        ) : keys.length === 0 ? (
          <p className="text-[11.5px] leading-relaxed text-[var(--text-faint)]">
            This project has no shared key. Your
            own key is used, or the local model.
          </p>
        ) : (
          <p className="text-[11.5px] leading-relaxed text-[var(--text-faint)]">
            This project shares{" "}
            {keys
              .map((entry) => entry.label)
              .join(" and ")}
            . You can use{" "}
            {keys.length === 1 ? "it" : "them"}{" "}
            without a key of your own, and the
            bill goes to the project owner.
          </p>
        )}
      </div>
    );
  }


  return (
    <div>
      {allowed ? (
        <p className="mb-2 text-[11.5px] leading-relaxed text-[var(--text-faint)]">
          Everyone in this project can use these
          without a key of their own, and nobody can
          read them. Their own key is used first
          where they have one, so nobody spends
          yours by accident.
        </p>
      ) : (
        <p className="mb-2 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
          Sharing one key with everyone in the
          project is part of{" "}
          <span className="text-[var(--text)]">
            {requiredPlan}
          </span>
          .
          {keys.length > 0 &&
            " Keys already shared are paused until then."}

          {onUpgrade && (
            <button
              type="button"
              onClick={onUpgrade}
              className="mt-2 block rounded-md bg-[var(--accent)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--bg)] transition hover:opacity-90"
            >
              Upgrade to {requiredPlan}
            </button>
          )}
        </p>
      )}

      <div className="space-y-1.5">
        {services.map((service) => {
          const existing = keys.find(
            (entry) =>
              entry.service === service.id
          );

          const open_ = adding === service.id;

          // Only ever show what is already
          // shared, plus whichever one is being
          // added. A list of nine services here
          // would bury the two that matter.

          if (!existing && !open_) {
            return null;
          }

          return (
            <div
              key={service.id}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--text)]">
                  {service.label}

                  {existing && (
                    <span className="ml-1.5 text-[10.5px] text-[var(--text-faint)]">
                      {existing.limit
                        ? `capped at $${existing.limit}/mo`
                        : "no monthly cap"}
                    </span>
                  )}
                </span>

                {existing && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      remove(service.id)
                    }
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10.5px] text-[var(--text-faint)] transition hover:text-red-300 disabled:opacity-40"
                  >
                    Remove
                  </button>
                )}
              </div>

              {open_ && (
                <div className="mt-2 flex gap-2 border-t border-[var(--border)] pt-2">
                  <input
                    type="password"
                    autoComplete="off"
                    value={key}
                    placeholder="Paste the API key"
                    onChange={(event) =>
                      setKey(event.target.value)
                    }
                    className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-[12.5px] text-[var(--text)] outline-none focus:border-[var(--border-strong)]"
                  />

                  <input
                    type="text"
                    inputMode="decimal"
                    value={limit}
                    placeholder="$/mo"
                    title="Monthly ceiling in dollars. Blank means no limit."
                    onChange={(event) =>
                      setLimit(event.target.value)
                    }
                    className="w-20 shrink-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-[12.5px] text-[var(--text)] outline-none focus:border-[var(--border-strong)]"
                  />

                  <button
                    type="button"
                    disabled={busy || !key.trim()}
                    onClick={() => save(service.id)}
                    className="shrink-0 rounded-md bg-[var(--accent)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--bg)] transition hover:opacity-90 disabled:opacity-40"
                  >
                    {busy ? "Saving…" : "Share"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {allowed && (
      <select
        value=""
        onChange={(event) => {
          setAdding(event.target.value);
          setKey("");
          setError("");
        }}
        className="mt-1.5 w-full rounded-lg border border-dashed border-[var(--border)] bg-transparent px-3 py-2 text-[11.5px] text-[var(--text-muted)] outline-none transition hover:border-[var(--border-strong)]"
      >
        <option value="">
          Share a key with the project…
        </option>

        {services
          .filter(
            (service) =>
              !keys.some(
                (entry) =>
                  entry.service === service.id
              )
          )
          .map((service) => (
            <option
              key={service.id}
              value={service.id}
            >
              {service.label}
            </option>
          ))}
      </select>
      )}

      {/* ---------------------------- */}
      {/* WHERE IT WENT                */}
      {/* ---------------------------- */}

      {reportPlan && keys.length > 0 && allowed && (
        <p className="mt-4 border-t border-[var(--border)] pt-3 text-[11px] leading-relaxed text-[var(--text-faint)]">
          A report of who spent what on this key
          comes with {reportPlan}.
        </p>
      )}

      {people.length > 0 && (
        <div className="mt-4 border-t border-[var(--border)] pt-3">
          <p className="mb-1.5 text-[10px] tracking-[0.12em] text-[var(--text-faint)] uppercase">
            This month
          </p>

          <div className="space-y-1">
            {people.map((person) => (
              <div
                key={person.name}
                className="flex items-center gap-2 text-[11.5px]"
              >
                <span className="min-w-0 flex-1 truncate text-[var(--text-muted)]">
                  {person.name}
                </span>

                <span className="shrink-0 text-[var(--text-faint)] tabular-nums">
                  {person.turns} turns
                </span>

                <span className="w-14 shrink-0 text-right text-[var(--text)] tabular-nums">
                  {person.usdLabel}
                </span>
              </div>
            ))}
          </div>

          {total && total !== "$0" && (
            <p className="mt-2 flex items-center gap-2 text-[11.5px]">
              <span className="min-w-0 flex-1 text-[var(--text-muted)]">
                On the shared key
              </span>

              <span className="shrink-0 text-[var(--text)] tabular-nums">
                {total}
              </span>
            </p>
          )}

          <p className="mt-2 text-[10.5px] leading-relaxed text-[var(--text-faint)]">
            Estimated from a price list that goes
            stale
            {estimated
              ? ", and some models here have no price on file, so this is a floor"
              : ""}
            . The provider&apos;s invoice is the
            real number.
          </p>
        </div>
      )}

      {error && (
        <p className="mt-2 rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-[12px] leading-relaxed text-red-200">
          {error}
        </p>
      )}
    </div>
  );
}
