"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { createClient } from "@/lib/supabase/client";

import {
  ChevronDown,
  Clock,
  Sparkle,
  Stop,
} from "@/components/ui/Icons";

import { PromptDialog } from "@/components/ui/Dialog";

import SchedulesDialog from "./SchedulesDialog";


// ==========================================
// AGENT DOCK
// ==========================================
//
// What a background agent is doing, live.
//
// The worker records every step it takes into
// agent_events. Those rows carry a project_id, so
// subscribing to them shows the same run to every
// teammate in the project rather than only the
// person who started it.
//

type Agent = {
  id: string;
  name: string;
  status: string;
  model: string;
  current_task: string | null;
};

type Run = {
  id: string;
  status: string;
  task: string;
  step: number;
};

type AgentEvent = {
  id: string;
  type: string;
  message: string;
  created_at: string;
};


const ACTIVE = ["queued", "running", "paused"];


function eventTone(type: string) {
  if (type === "error") {
    return "text-rose-400";
  }

  if (type === "completed") {
    return "text-emerald-400";
  }

  if (type === "paused" || type === "stopped") {
    return "text-amber-400";
  }

  return "text-[var(--text-muted)]";
}


export default function AgentDock({
  projectId,
  channelId,
  channelName,
}: {
  projectId: string | null;
  channelId: string | null;
  channelName?: string | null;
}) {
  // Tasks this channel's agent does on a timer.
  const [schedulesOpen, setSchedulesOpen] = useState(false);

  const [scheduleCount, setScheduleCount] = useState(0);

  // How many, for the button, without opening the
  // list. Quietly nothing before migration 0023.

  useEffect(() => {
    if (!projectId || !channelId) {
      return;
    }

    let cancelled = false;

    fetch(`/api/projects/${projectId}/schedules?channelId=${channelId}`, {
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled) {
          setScheduleCount(data?.schedules?.length ?? 0);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [projectId, channelId]);

  const [agent, setAgent] =
    useState<Agent | null>(null);

  const [run, setRun] = useState<Run | null>(null);

  const [events, setEvents] = useState<
    AgentEvent[]
  >([]);

  // Collapsed by default. The bar says whether
  // anything is running; the step-by-step feed is
  // there when you go looking for it.

  const [open, setOpen] = useState(false);

  const [busy, setBusy] = useState(false);

  const [asking, setAsking] = useState(false);

  const [error, setError] = useState<
    string | null
  >(null);

  const feedRef = useRef<HTMLDivElement>(null);


  // ----------------------------------------
  // LOAD
  // ----------------------------------------

  const load = useCallback(async () => {
    if (!projectId) {
      return;
    }

    try {
      const response = await fetch(
        `/api/agents/activity?projectId=${projectId}${
          channelId
            ? `&channelId=${channelId}`
            : ""
        }`,
        { cache: "no-store" }
      );

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? null);

        return;
      }

      setError(null);
      setAgent(data.agent ?? null);
      setRun(data.run ?? null);
      setEvents(data.events ?? []);
    } catch {
      // A failed poll is not worth surfacing;
      // the next one usually succeeds.
    }
  }, [projectId, channelId]);


  useEffect(() => {
    if (!projectId) {
      return;
    }

    void load();

    // Steps arrive as they are written, so the
    // feed keeps up with the worker without
    // polling it.

    const supabase = createClient();

    const channel = supabase
      .channel(`agent-activity:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "agent_events",
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          const next =
            payload.new as AgentEvent;

          setEvents((previous) =>
            previous.some(
              (item) => item.id === next.id
            )
              ? previous
              : [...previous.slice(-60), next]
          );

          // A step finishing can change the run
          // and the agent, so refresh those.

          void load();
        }
      )
      .subscribe();

    // Realtime is the fast path, not the only
    // one. A single missed event used to leave the
    // dock claiming a finished run was still going,
    // offering a Pause the server then refused.
    // Polling means any stale state corrects itself.
    //
    // Only a backstop, so it is unhurried, and a tab
    // nobody is looking at does not poll at all: a
    // room of people on one network was spending most
    // of its shared allowance on this check alone.

    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        void load();
      }
    }, 15_000);

    // Coming back to the tab catches up at once.
    function onVisible() {
      if (document.visibilityState === "visible") {
        void load();
      }
    }

    document.addEventListener("visibilitychange", onVisible);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [projectId, load]);


  // Show the newest step, not the oldest.
  //
  // Same trap as the conversation: setting
  // scrollTop once runs before the rows have laid
  // out, so pin again on the next frame. Runs on
  // open too, since the feed starts collapsed and
  // has no height until it is expanded.

  useEffect(() => {
    if (!open) {
      return;
    }

    function pin() {
      const element = feedRef.current;

      if (element) {
        element.scrollTop =
          element.scrollHeight;
      }
    }

    pin();

    const frame = requestAnimationFrame(() => {
      pin();

      requestAnimationFrame(pin);
    });

    return () => cancelAnimationFrame(frame);
  }, [events, open]);


  // ----------------------------------------
  // CONTROLS
  // ----------------------------------------

  // Throws on failure, which is how the dialog
  // knows to stay open and keep what was typed.

  async function start(task: string) {
    if (!agent) {
      return;
    }

    const response = await fetch(
      `/api/agents/${agent.id}/run`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({ task }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error ??
          "Could not start the agent."
      );
    }

    await load();
  }


  async function control(
    action: "pause" | "resume" | "stop"
  ) {
    if (!agent) {
      return;
    }

    setBusy(true);

    try {
      const response = await fetch(
        `/api/agents/${agent.id}/control`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ?? "Could not do that."
        );
      }

      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not control the agent."
      );

      // Usually this means the dock was showing
      // something the server no longer agrees
      // with, so fetch the truth.

      await load();
    } finally {
      setBusy(false);
    }
  }


  if (!projectId || !agent) {
    return null;
  }

  const active =
    run !== null && ACTIVE.includes(run.status);

  const working = run?.status === "running";
  const paused = run?.status === "paused";

  return (
    <div className="shrink-0 px-4 pb-2 sm:px-6">
      <div className="mx-auto max-w-3xl">

        {/* A card above the composer and aligned
            to it, rather than a bar welded to the
            edges of the window. Expanding grows
            the same card downwards. */}

        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-panel)]">

          {/* -------------------------------- */}
          {/* BAR                              */}
          {/* -------------------------------- */}

          <div className="flex items-center gap-2.5 px-3 py-2">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                working
                  ? "animate-pulse bg-[var(--accent)]"
                  : paused
                    ? "bg-amber-500"
                    : "bg-[var(--border-strong)]"
              }`}
            />

            <span className="text-[12px] font-medium text-[var(--text)]">
              {agent.name}
            </span>

            <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--text-faint)]">
              {active
                ? run?.task
                : "No background task running"}
            </span>

            {channelId && (
              <button
                type="button"
                onClick={() => setSchedulesOpen(true)}
                title="Tasks this agent does on its own, on a schedule"
                className="flex items-center gap-1 rounded-lg border border-[var(--border-strong)] px-2 py-1 text-[11.5px] text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)]"
              >
                <Clock className="h-3.5 w-3.5" />

                <span className="hidden sm:inline">
                  {scheduleCount > 0 ? `Scheduled · ${scheduleCount}` : "Schedule"}
                </span>

                {scheduleCount > 0 && (
                  <span className="sm:hidden">{scheduleCount}</span>
                )}
              </button>
            )}

            {!active && (
              <button
                type="button"
                onClick={() => setAsking(true)}
                disabled={busy}
                title="Give the agent a task to work through on its own, in the background"
                className="rounded-lg border border-[var(--border-strong)] px-2.5 py-1 text-[11.5px] text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)] disabled:opacity-40"
              >
                New task
              </button>
            )}

            {working && (
              <button
                type="button"
                onClick={() => control("pause")}
                disabled={busy}
                className="rounded-lg border border-[var(--border-strong)] px-2.5 py-1 text-[11.5px] text-[var(--text-muted)] transition hover:text-[var(--text)] disabled:opacity-40"
              >
                Pause
              </button>
            )}

            {paused && (
              <button
                type="button"
                onClick={() => control("resume")}
                disabled={busy}
                className="rounded-lg border border-[var(--border-strong)] px-2.5 py-1 text-[11.5px] text-[var(--text-muted)] transition hover:text-[var(--text)] disabled:opacity-40"
              >
                Resume
              </button>
            )}

            {active && (
              <button
                type="button"
                onClick={() => control("stop")}
                disabled={busy}
                aria-label="Stop the agent"
                title="Stop"
                className="flex h-6 w-6 items-center justify-center rounded-lg text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40"
              >
                <Stop className="h-3.5 w-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={() => setOpen(!open)}
              aria-label={
                open
                  ? "Hide activity"
                  : "Show activity"
              }
              className="flex h-6 w-6 items-center justify-center rounded-lg text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
            >
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${
                  open ? "" : "rotate-180"
                }`}
              />
            </button>
          </div>


          {/* -------------------------------- */}
          {/* FEED                             */}
          {/* -------------------------------- */}

          {open && (
            <div
              ref={feedRef}
              className="max-h-52 overflow-y-auto border-t border-[var(--border)] px-3 py-2"
            >
              {error ? (
                <p className="text-[11.5px] text-rose-400">
                  {error}
                </p>
              ) : events.length === 0 ? (
                <p className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-faint)]">
                  <Sparkle className="h-3 w-3 shrink-0" />
                  Nothing yet. Run the agent and its
                  steps appear here for everyone in
                  the project.
                </p>
              ) : (
                <div className="space-y-0.5">
                  {events.map((event) => (
                    <div
                      key={event.id}
                      className="flex gap-2 text-[11.5px] leading-relaxed"
                    >
                      <span className="shrink-0 font-mono text-[var(--text-faint)]">
                        {new Date(
                          event.created_at
                        ).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>

                      {/* A finished run writes
                          its whole summary here,
                          which wraps to several
                          lines and buries the
                          steps around it. One
                          line in the log; the
                          full text is in the
                          chat, and on hover. */}

                      <span
                        title={event.message}
                        className={`min-w-0 flex-1 truncate ${eventTone(
                          event.type
                        )}`}
                      >
                        {event.message}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>


      {/* ------------------------------ */}
      {/* GIVING IT SOMETHING TO DO      */}
      {/* ------------------------------ */}

      <PromptDialog
        open={asking}
        title="New background task"
        description="The agent works through this on its own, a step at a time, and keeps going if you close the tab. You can pause or stop it from here."
        label="Task"
        placeholder="Read notes.md and write a summary"
        initialValue={agent?.current_task ?? ""}
        confirmLabel="Start"
        multiline
        onSubmit={start}
        onClose={() => setAsking(false)}
      />

      {channelId && (
        <SchedulesDialog
          open={schedulesOpen}
          onClose={() => setSchedulesOpen(false)}
          projectId={projectId}
          channelId={channelId}
          channelName={channelName ?? "this channel"}
          onChanged={setScheduleCount}
        />
      )}
    </div>
  );
}
