"use client";

import { useEffect, useRef, useState } from "react";


// ==========================================
// HOW MUCH IS LEFT
// ==========================================
//
// A small ring under the message box that fills
// with whichever is closest to running out: the
// conversation's context window, today's built-in
// messages, or the chosen Gemini model's daily
// limit. Click it for the breakdown.
//
// Everything in here is Teamski's own count.
// Google does not tell an app what is left on a
// key, so a key used outside Teamski will run out
// sooner than this says - the panel says so.
//

type ModelUsage = {
  id: string;
  label: string;
  requests: number;
  dailyLimit: number | null;
};

type KeyUsage = {
  resetsAt: string;
  models: ModelUsage[];
};

type Allowance = {
  used: number;
  limit: number;
  planLabel: string;
  resetsAt: string;
};


function percentOf(part: number, whole: number | null | undefined) {
  if (!whole) {
    return null;
  }

  return Math.min(100, Math.round((part / whole) * 100));
}


function compact(tokens: number) {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 ? 1 : 0)}M`;
  }

  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k`;
  }

  return String(tokens);
}


function resetsIn(iso: string, now: number) {
  const minutes = Math.max(0, Math.round((new Date(iso).getTime() - now) / 60_000));

  const hours = Math.floor(minutes / 60);

  return hours > 0
    ? `Resets in ${hours} hr ${minutes % 60} min`
    : `Resets in ${minutes} min`;
}


function tone(percent: number) {
  return percent >= 90
    ? "bg-red-400"
    : percent >= 70
      ? "bg-amber-300"
      : "bg-[#5b8def]";
}


function Bar({ percent }: { percent: number }) {
  return (
    <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-[var(--bg-hover)]">
      <div
        className={`h-full rounded-full ${tone(percent)}`}
        style={{ width: `${Math.max(percent, percent > 0 ? 2 : 0)}%` }}
      />
    </div>
  );
}


export default function UsageRing({
  projectId,
  model,
  contextTokens,
  contextWindow,
  lastTurnTokens,
  onOpenSettings,
}: {
  projectId?: string | null;

  // The chosen model, qualified: "google/gemini-3.8-flash"
  // or a local name.
  model: string;

  contextTokens?: number;
  contextWindow?: number;
  lastTurnTokens?: number;

  onOpenSettings?: () => void;
}) {
  const [open, setOpen] = useState(false);

  const [gemini, setGemini] = useState<KeyUsage | null>(null);

  const [allowance, setAllowance] = useState<Allowance | null>(null);

  // Read at the moment of fetching, so "resets in"
  // is computed from a value rather than calling
  // the clock during render.
  const [now, setNow] = useState(0);

  const boxRef = useRef<HTMLDivElement>(null);

  // Fresh numbers after every reply and every time
  // the panel opens.

  useEffect(() => {
    let cancelled = false;

    const query = projectId ? `?projectId=${projectId}` : "";

    Promise.all([
      fetch(`/api/models/keys${query}`, { cache: "no-store" })
        .then((response) => response.json())
        .catch(() => null),

      fetch(`/api/billing${query}`, { cache: "no-store" })
        .then((response) => response.json())
        .catch(() => null),
    ]).then(([keys, billing]) => {
      if (cancelled) {
        return;
      }

      setGemini(keys?.usage?.google ?? null);
      setAllowance(billing?.today ?? null);
      setNow(Date.now());
    });

    return () => {
      cancelled = true;
    };
  }, [projectId, lastTurnTokens, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function away(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);

    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);


  const local = !model.includes("/");

  const onGemini = model.startsWith("google/");

  // Both the machine's own models and the shared
  // Groq key are answered on the built-in daily
  // allowance (a Groq turn counts as "server"), so
  // the ring reflects that allowance for either.
  const usesAllowance =
    local || model.startsWith("groq/");

  const context = contextTokens ? percentOf(contextTokens, contextWindow) : null;

  const current = onGemini
    ? gemini?.models.find((entry) => `google/${entry.id}` === model)
    : undefined;

  const modelPercent = current ? percentOf(current.requests, current.dailyLimit) : null;

  const allowancePercent =
    usesAllowance && allowance ? percentOf(allowance.used, allowance.limit) : null;

  // The ring shows whatever is nearest its end.
  const ring = Math.max(context ?? 0, modelPercent ?? 0, allowancePercent ?? 0);

  const radius = 5.5;
  const circumference = 2 * Math.PI * radius;

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={`Usage: ${ring}% of the nearest limit`}
        title="Usage and limits"
        className="flex h-6 w-6 items-center justify-center rounded-md transition hover:bg-[var(--bg-hover)]"
      >
        <svg viewBox="0 0 14 14" className="h-3.5 w-3.5 -rotate-90" aria-hidden="true">
          <circle cx="7" cy="7" r={radius} fill="none" stroke="var(--border-strong)" strokeWidth="2" />
          <circle
            cx="7"
            cy="7"
            r={radius}
            fill="none"
            stroke={ring >= 90 ? "#f87171" : ring >= 70 ? "#fcd34d" : "#5b8def"}
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - Math.max(ring, 4) / 100)}
          />
        </svg>
      </button>

      {open && (
        <div data-origin="bottom-right" className="t-dropdown absolute right-0 bottom-8 z-30 w-[min(20rem,calc(100vw-1.5rem))] rounded-xl border border-[var(--border-strong)] bg-[var(--bg-panel)] py-2 shadow-2xl shadow-black/50">

          {/* CONTEXT WINDOW */}

          <div className="px-3.5 py-1.5">
            <div className="flex items-baseline gap-2 text-[12px]">
              <span className="text-[var(--text-muted)]">Context window</span>

              <span className="ml-auto text-[var(--text-faint)] tabular-nums">
                {contextTokens && contextWindow
                  ? `${compact(contextTokens)} / ${compact(contextWindow)} (${context}%)`
                  : "Starts with the first reply"}
              </span>
            </div>

            {context !== null && <Bar percent={context} />}

            {lastTurnTokens ? (
              <p className="mt-1.5 text-[11px] text-[var(--text-faint)]">
                Last reply: {lastTurnTokens.toLocaleString()} tokens
              </p>
            ) : null}
          </div>

          {/* BUILT-IN ALLOWANCE */}

          {allowance && (
            <div className="mt-1 border-t border-[var(--border)] px-3.5 pt-2.5 pb-1.5">
              <div className="flex items-baseline gap-2 text-[12px]">
                <span className={usesAllowance ? "font-medium text-[var(--text)]" : "text-[var(--text-muted)]"}>
                  Built-in AI · {allowance.planLabel}
                </span>

                <span className="ml-auto text-[11px] text-[var(--text-faint)]">
                  {resetsIn(allowance.resetsAt, now)}
                </span>

                <span className="text-[12px] text-[var(--text)] tabular-nums">
                  {percentOf(allowance.used, allowance.limit)}%
                </span>
              </div>

              <Bar percent={percentOf(allowance.used, allowance.limit) ?? 0} />

              <p className="mt-1 text-[11px] text-[var(--text-faint)] tabular-nums">
                {allowance.used} of {allowance.limit} messages today
              </p>
            </div>
          )}

          {/* GEMINI, PER MODEL */}

          {gemini && gemini.models.length > 0 && (
            <div className="mt-1 border-t border-[var(--border)] px-3.5 pt-2.5 pb-1.5">
              <div className="flex items-baseline gap-2 text-[12px]">
                <span className="text-[var(--text-muted)]">Your Gemini key</span>

                <span className="ml-auto text-[11px] text-[var(--text-faint)]">
                  {resetsIn(gemini.resetsAt, now)}
                </span>
              </div>

              <div className="mt-2 space-y-2.5">
                {gemini.models.map((entry) => {
                  const percent = percentOf(entry.requests, entry.dailyLimit);

                  const chosen = `google/${entry.id}` === model;

                  return (
                    <div key={entry.id}>
                      <div className="flex items-baseline gap-2 text-[12px]">
                        <span
                          className={`min-w-0 truncate ${
                            chosen ? "font-medium text-[var(--text)]" : "text-[var(--text-muted)]"
                          }`}
                        >
                          {entry.label.replace(/\s*\(.*\)$/, "")}
                        </span>

                        <span className="ml-auto shrink-0 text-[11px] text-[var(--text-faint)] tabular-nums">
                          {entry.requests}
                          {entry.dailyLimit ? ` / ${entry.dailyLimit}` : ""}
                        </span>

                        {percent !== null && (
                          <span className="w-9 shrink-0 text-right text-[12px] text-[var(--text)] tabular-nums">
                            {percent}%
                          </span>
                        )}
                      </div>

                      {percent !== null && <Bar percent={percent} />}
                    </div>
                  );
                })}
              </div>

              <p className="mt-2 text-[10.5px] leading-relaxed text-[var(--text-faint)]">
                Counted from Teamski only. When a model runs out, another one
                answers.
              </p>
            </div>
          )}

          {onOpenSettings && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
              className="mt-1 flex w-full items-center border-t border-[var(--border)] px-3.5 pt-2.5 pb-1 text-left text-[12px] text-[var(--text-muted)] transition hover:text-[var(--text)]"
            >
              Keys and limits
              <span className="ml-auto" aria-hidden="true">→</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
