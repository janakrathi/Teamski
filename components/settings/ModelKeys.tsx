"use client";

import { useCallback, useEffect, useState } from "react";

import { cachedJson, peekJson } from "@/lib/net/cache";


// ==========================================
// YOUR OWN MODEL KEYS
// ==========================================
//
// A key belongs to whoever it bills, not to
// whoever owns the server. So everyone adds
// their own here, it is stored against their
// account alone, and nothing ever reads it back
// out - this panel shows which services are
// connected, never the secret.
//
// Most of the list is one integration: Groq,
// DeepSeek, Mistral, OpenRouter, Together and
// anything a company runs themselves all serve
// OpenAI's API at a different address.
//

type Service = {
  id: string;
  label: string;
  keysUrl?: string;
  baseUrl?: string;
  selfHosted?: boolean;
  note?: string;
  native: boolean;

  // The four almost everybody is here for. The
  // rest are real options, not lesser ones -
  // just not what somebody opening this panel
  // for the first time is looking for.
  primary?: boolean;
};

// Today's use of a free key, per model, and the
// daily limit the person entered for each from
// AI Studio.
type ModelUsage = {
  id: string;
  label: string;
  requests: number;
  dailyLimit: number | null;
};

type KeyUsage = {
  since: string;
  models: ModelUsage[];
};

type Connected = {
  service: string;
  label: string;
  models: number;
};


export default function ModelKeys({
  projectId,
  onChanged,
  onUpgrade,
}: {
  // Keys work where the project's plan includes
  // them, so this is the plan asked about.
  projectId?: string | null;

  // The picker above shares this data, so it has
  // to hear when the list changes - and which
  // model became the default, if one did.
  onChanged?: (change?: { defaultModel?: string | null }) => void;

  // Takes you to the plan page.
  onUpgrade?: () => void;
}) {
  const keysUrl = projectId
    ? `/api/models/keys?projectId=${projectId}`
    : "/api/models/keys";

  // What the cache already holds for this scope, so
  // reopening the tab shows the keys with no reload.
  const known = peekJson<{
    services?: Service[];
    connected?: Connected[];
  }>(keysUrl);

  const [services, setServices] = useState<
    Service[]
  >(known?.services ?? []);

  const [connected, setConnected] = useState<
    Connected[]
  >(known?.connected ?? []);

  const [adding, setAdding] = useState<
    string | null
  >(null);

  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [models, setModels] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [showAll, setShowAll] = useState(false);

  // Whether this account's plan includes its own
  // keys. Assumed until the server says otherwise,
  // so a paid account never flashes a lock.

  const [allowed, setAllowed] = useState(true);

  const [requiredPlan, setRequiredPlan] =
    useState("Pro");

  // Services any plan may bring a key for.
  const [freeServices, setFreeServices] = useState<string[]>([]);

  const [usage, setUsage] = useState<Record<string, KeyUsage>>({});

  // The limit being typed, per "service:model".
  const [limitDraft, setLimitDraft] = useState<Record<string, string>>({});

  const canAdd = (id: string) =>
    allowed || freeServices.includes(id);

  // Said once a free key is in: it worked, and
  // what answers now.
  const [switched, setSwitched] = useState("");


  // `force` re-reads past the cache, after a change.
  const load = useCallback(
    async (force = false) => {
      try {
        const list = (await cachedJson(keysUrl, {
          force,
        })) as {
          services?: Service[];
          connected?: Connected[];
          usage?: Record<string, KeyUsage>;
          allowed?: boolean;
          requiredPlan?: string;
          freeServices?: string[];
        };

        setServices(list.services ?? []);

        setConnected(list.connected ?? []);

        setUsage(list.usage ?? {});

        setAllowed(list.allowed !== false);

        setRequiredPlan(list.requiredPlan ?? "Pro");

        setFreeServices(list.freeServices ?? []);
      } catch {
        setError("Could not load model services.");
      }
    },
    [keysUrl]
  );


  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);


  function open(service: Service) {
    setAdding(service.id);
    setKey("");
    setBaseUrl(service.baseUrl ?? "");
    setModels("");
    setError("");
  }


  async function save(service: Service) {
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
            service: service.id,
            key,
            baseUrl,
            models,
            projectId,
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

      if (data.defaultModel) {
        setSwitched(
          `Connected. New messages are answered by ${data.defaultModel.split("/")[1]}.`
        );
      }

      await load(true);

      onChanged?.({ defaultModel: data.defaultModel ?? null });
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


  async function saveLimit(service: string, model: string) {
    const slot = `${service}:${model}`;

    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/models/keys", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service,
          model,
          dailyLimit: (limitDraft[slot] ?? "").trim() || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not save that limit.");
      }

      setLimitDraft((draft) => {
        const next = { ...draft };
        delete next[slot];
        return next;
      });

      await load(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save that limit."
      );
    } finally {
      setBusy(false);
    }
  }


  async function remove(service: string) {
    setBusy(true);

    try {
      await fetch(
        `/api/models/keys?service=${service}`,
        { method: "DELETE" }
      );

      await load(true);

      onChanged?.();
    } finally {
      setBusy(false);
    }
  }


  const isConnected = (id: string) =>
    connected.some(
      (entry) => entry.service === id
    );

  const rest = services.filter(
    (service) => !service.primary
  );

  // A connected service is never hidden behind
  // the expander - somebody who set one up should
  // see it without remembering where they put it.

  // On a plan without keys, the free ones come
  // first: they are the ones that work.

  const shown = [...(showAll
    ? services
    : services.filter(
        (service) =>
          service.primary ||
          isConnected(service.id)
      )
  )].sort(
    (a, b) =>
      Number(canAdd(b.id)) - Number(canAdd(a.id))
  );

  const hiddenCount = rest.filter(
    (service) => !isConnected(service.id)
  ).length;


  return (
    <div>
      {allowed ? (
        <p className="mb-2 text-[11.5px] leading-relaxed text-[var(--text-faint)]">
          Keys are yours alone — stored against your
          account, never shown again, and never
          shared with teammates. Whatever you use is
          billed to your account with that service.
        </p>
      ) : (
        <>
          {/* The fast way to a good model on Free: */}
          {/* a Gemini key costs nothing to get.    */}

          {freeServices.includes("google") && !isConnected("google") && (
            <div className="mb-2 rounded-lg border border-[var(--accent)]/40 bg-[var(--bg-raised)] px-3 py-2.5">
              <p className="text-[12.5px] font-medium text-[var(--text)]">
                Faster answers, free: use Google Gemini
              </p>

              <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
                <li>
                  Open{" "}
                  <a
                    href="https://aistudio.google.com/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--text)] underline underline-offset-2"
                  >
                    Google AI Studio
                  </a>{" "}
                  and sign in with any Google account.
                </li>
                <li>Click Create API key and copy it.</li>
                <li>Paste it below. Teamski switches to Gemini for you.</li>
              </ol>
            </div>
          )}

          <p className="mb-2 text-[11px] leading-relaxed text-[var(--text-faint)]">
            Keys for Claude, ChatGPT and the other
            services are part of{" "}
            <span className="text-[var(--text-muted)]">
              {requiredPlan}
            </span>
            .{" "}

            {onUpgrade && (
              <button
                type="button"
                onClick={onUpgrade}
                className="text-[var(--text-muted)] underline underline-offset-2 transition hover:text-[var(--text)]"
              >
                Upgrade
              </button>
            )}
          </p>
        </>
      )}

      {switched && (
        <p className="mb-2 rounded-lg border border-emerald-900/50 bg-emerald-950/20 px-3 py-2 text-[11.5px] text-emerald-300">
          {switched}
        </p>
      )}

      <div className="space-y-1.5">
        {shown.map((service) => {
          const linked = isConnected(service.id);

          const open_ = adding === service.id;

          return (
            <div
              key={service.id}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--text)]">
                  {service.label}

                  {service.selfHosted && (
                    <span className="ml-1.5 text-[10.5px] text-[var(--text-faint)]">
                      vLLM, LM Studio, anything
                      OpenAI-compatible
                    </span>
                  )}
                </span>

                {linked ? (
                  <>
                    {canAdd(service.id) ? (
                      <span className="shrink-0 text-[10.5px] text-emerald-400">
                        connected
                      </span>
                    ) : (
                      <span
                        title={`Saved, but not used until you are on ${requiredPlan}`}
                        className="shrink-0 text-[10.5px] text-amber-300"
                      >
                        paused
                      </span>
                    )}

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
                  </>
                ) : !canAdd(service.id) ? (
                  <button
                    type="button"
                    onClick={onUpgrade}
                    title={`Available on ${requiredPlan}`}
                    className="shrink-0 rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-faint)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-muted)]"
                  >
                    {requiredPlan}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      open_
                        ? setAdding(null)
                        : open(service)
                    }
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10.5px] text-[var(--text-muted)] transition hover:text-[var(--text)]"
                  >
                    {open_ ? "Cancel" : "Add key"}
                  </button>
                )}
              </div>


              {/* HOW MUCH OF TODAY IS USED */}

              {linked && usage[service.id] && (
                <div className="mt-2 space-y-2.5 border-t border-[var(--border)] pt-2">
                  {usage[service.id].models.map((model) => {
                    const slot = `${service.id}:${model.id}`;

                    return (
                      <UsageMeter
                        key={model.id}
                        usage={model}
                        draft={limitDraft[slot]}
                        busy={busy}
                        onDraft={(value) =>
                          setLimitDraft((draft) => ({ ...draft, [slot]: value }))
                        }
                        onSave={() => saveLimit(service.id, model.id)}
                        onCancel={() =>
                          setLimitDraft((draft) => {
                            const next = { ...draft };
                            delete next[slot];
                            return next;
                          })
                        }
                      />
                    );
                  })}

                  <p className="text-[10.5px] leading-relaxed text-[var(--text-faint)]">
                    Each model has its own daily limit (RPD) on{" "}
                    <a
                      href="https://aistudio.google.com/rate-limit"
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      AI Studio&apos;s rate limit page
                    </a>
                    . When one runs out, Teamski answers with another that
                    still has room. Counted from Teamski only, since midnight
                    Pacific time.
                  </p>
                </div>
              )}


              {open_ && (
                <div className="mt-2 space-y-2 border-t border-[var(--border)] pt-2">
                  {!service.selfHosted && (
                    <input
                      type="password"
                      autoComplete="off"
                      value={key}
                      placeholder="Paste the API key"
                      onChange={(event) =>
                        setKey(event.target.value)
                      }
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-[12.5px] text-[var(--text)] outline-none focus:border-[var(--border-strong)]"
                    />
                  )}

                  {!service.native && (
                    <input
                      type="text"
                      value={baseUrl}
                      placeholder="https://your-server/v1"
                      onChange={(event) =>
                        setBaseUrl(
                          event.target.value
                        )
                      }
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 font-mono text-[11.5px] text-[var(--text)] outline-none focus:border-[var(--border-strong)]"
                    />
                  )}

                  {service.note && (
                    <p className="text-[11px] leading-relaxed text-[var(--text-faint)]">
                      {service.note}
                    </p>
                  )}

                  <input
                    type="text"
                    value={models}
                    placeholder="Model ids, comma separated — blank for the usual ones"
                    onChange={(event) =>
                      setModels(event.target.value)
                    }
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 font-mono text-[11.5px] text-[var(--text)] outline-none focus:border-[var(--border-strong)]"
                  />

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => save(service)}
                      className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--bg)] transition hover:opacity-90 disabled:opacity-40"
                    >
                      {busy
                        ? "Checking…"
                        : "Save"}
                    </button>

                    {service.keysUrl && (
                      <a
                        href={service.keysUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-[var(--text-faint)] underline underline-offset-2 transition hover:text-[var(--text-muted)]"
                      >
                        Get a key
                      </a>
                    )}

                    <span className="ml-auto text-[10.5px] text-[var(--text-faint)]">
                      Checked before it is saved
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!showAll && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-[11.5px] text-[var(--text-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--text)]"
        >
          <span>More</span>

          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="h-3 w-3"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
      )}

      {showAll && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="mt-1.5 w-full rounded-lg px-3 py-1.5 text-[11.5px] text-[var(--text-faint)] transition hover:text-[var(--text-muted)]"
        >
          Show fewer
        </button>
      )}

      {error && (
        <p className="mt-2 rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-[12px] leading-relaxed text-red-200">
          {error}
        </p>
      )}
    </div>
  );
}


// ------------------------------------------
// TODAY'S USE OF A FREE KEY
// ------------------------------------------
//
// One model's line: a bar once there is a limit
// to measure against; until then, the count and a
// way to enter the limit.

function UsageMeter({
  usage,
  draft,
  busy,
  onDraft,
  onSave,
  onCancel,
}: {
  usage: ModelUsage;
  draft: string | undefined;
  busy: boolean;
  onDraft: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const editing = draft !== undefined;

  const percent =
    usage.dailyLimit !== null
      ? Math.min(100, Math.round((usage.requests / usage.dailyLimit) * 100))
      : null;

  const tone =
    percent === null
      ? ""
      : percent >= 90
        ? "bg-red-400"
        : percent >= 70
          ? "bg-amber-300"
          : "bg-emerald-400";

  return (
    <div>
      <div className="flex items-baseline gap-2 text-[11px]">
        <span className="min-w-0 truncate text-[var(--text)]">
          {usage.label.replace(/\s*\(.*\)$/, "")}
        </span>

        <span className="shrink-0 text-[var(--text-faint)] tabular-nums">
          {usage.requests.toLocaleString()}
          {usage.dailyLimit !== null
            ? ` / ${usage.dailyLimit.toLocaleString()} today`
            : ` ${usage.requests === 1 ? "request" : "requests"} today`}
        </span>

        {percent !== null && (
          <span className="ml-auto font-medium text-[var(--text)] tabular-nums">
            {percent}%
          </span>
        )}
      </div>

      {percent !== null && (
        <div
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--bg)]"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="Share of today's limit used"
        >
          <div
            className={`h-full rounded-full ${tone}`}
            style={{ width: `${Math.max(percent, 2)}%` }}
          />
        </div>
      )}

      {editing ? (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={draft}
            placeholder="Requests per day"
            onChange={(event) => onDraft(event.target.value)}
            className="w-32 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[16px] text-[var(--text)] outline-none focus:border-[var(--border-strong)] sm:text-[11.5px]"
          />

          <button
            type="button"
            disabled={busy}
            onClick={onSave}
            className="rounded-md bg-[var(--accent)] px-2 py-1 text-[11px] font-medium text-[var(--bg)] transition hover:opacity-90 disabled:opacity-40"
          >
            Save
          </button>

          <button
            type="button"
            onClick={onCancel}
            className="text-[11px] text-[var(--text-faint)] transition hover:text-[var(--text-muted)]"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onDraft(usage.dailyLimit ? String(usage.dailyLimit) : "")}
          className="mt-1 text-[10.5px] text-[var(--text-faint)] underline underline-offset-2 transition hover:text-[var(--text-muted)]"
        >
          {usage.dailyLimit === null
            ? "Set its daily limit"
            : "Change limit"}
        </button>
      )}

    </div>
  );
}
