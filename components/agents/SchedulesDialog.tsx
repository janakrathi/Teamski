"use client";

import { useCallback, useEffect, useState } from "react";

import { Dialog, DialogButton } from "@/components/ui/Dialog";

import {
  SCHEDULE_IDEAS,
  WEEKDAYS,
  describeTiming,
  type Cadence,
} from "@/lib/agents/schedule";


// ==========================================
// A CHANNEL'S SCHEDULED TASKS
// ==========================================
//
// What this channel's agent does on its own, and
// when - with a form to add another. Everyone in
// the project sees the list; whoever added a
// schedule, or an owner, can change it.
//

export type ScheduleView = {
  id: string;
  title: string;
  task: string;
  cadence: Cadence;
  timeOfDay: string;
  weekday: number | null;
  monthDay: number | null;
  timezone: string;
  enabled: boolean;
  when: string;
  nextRunAt: string;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastError: string | null;
  addedBy: string;
  canChange: boolean;
};

type Draft = {
  title: string;
  task: string;
  cadence: Cadence;
  timeOfDay: string;
  weekday: number;
  monthDay: number;
};

const EMPTY: Draft = {
  title: "",
  task: "",
  cadence: "weekdays",
  timeOfDay: "09:00",
  weekday: 1,
  monthDay: 1,
};


function browserTimezone() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";

    // Some browsers still report India under its
    // old name.
    return zone === "Asia/Calcutta" ? "Asia/Kolkata" : zone;
  } catch {
    return "Asia/Kolkata";
  }
}


function whenText(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}


const field =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2 text-[16px] text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--border-strong)] sm:text-[13px]";


export default function SchedulesDialog({
  open,
  onClose,
  projectId,
  channelId,
  channelName,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  channelId: string;
  channelName: string;

  // The dock shows how many there are.
  onChanged?: (count: number) => void;
}) {
  const [schedules, setSchedules] = useState<ScheduleView[]>([]);

  const [limit, setLimit] = useState<{ used: number; limit: number; planLabel: string } | null>(
    null
  );

  const [adding, setAdding] = useState(false);

  const [draft, setDraft] = useState<Draft>(EMPTY);

  const [busy, setBusy] = useState<string | null>(null);

  const [error, setError] = useState("");

  const timezone = browserTimezone();

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/projects/${projectId}/schedules?channelId=${channelId}`,
        { cache: "no-store" }
      );

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Could not load schedules.");

        return;
      }

      setSchedules(data.schedules ?? []);
      setLimit({ used: data.used, limit: data.limit, planLabel: data.planLabel });
      onChanged?.((data.schedules ?? []).length);

      if ((data.schedules ?? []).length === 0) {
        setAdding(true);
      }
    } catch {
      setError("Could not load schedules.");
    }
  }, [projectId, channelId, onChanged]);

  // A fresh start each time it opens. Deferred a
  // tick, so opening is one render, not several.

  useEffect(() => {
    if (!open) {
      return;
    }

    void Promise.resolve().then(() => {
      setError("");
      setAdding(false);
      setDraft(EMPTY);

      return load();
    });
  }, [open, load]);


  async function send(
    key: string,
    method: "POST" | "PATCH" | "DELETE",
    body?: Record<string, unknown>,
    query = ""
  ) {
    setBusy(key);
    setError("");

    try {
      const response = await fetch(`/api/projects/${projectId}/schedules${query}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "That did not work.");
      }

      await load();

      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.");

      return false;
    } finally {
      setBusy(null);
    }
  }


  async function create() {
    const saved = await send("create", "POST", {
      channelId,
      title: draft.title,
      task: draft.task,
      cadence: draft.cadence,
      timeOfDay: draft.timeOfDay,
      weekday: draft.weekday,
      monthDay: draft.monthDay,
      timezone,
    });

    if (saved) {
      setAdding(false);
      setDraft(EMPTY);
    }
  }


  const full = limit !== null && limit.used >= limit.limit;

  const preview = describeTiming({
    cadence: draft.cadence,
    timeOfDay: draft.timeOfDay || "09:00",
    weekday: draft.weekday,
    monthDay: draft.monthDay,
    timezone,
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title={`Scheduled tasks in #${channelName}`}
      description="The channel's agent does these on its own at the time you set, and posts what it finds here for everyone."
      footer={
        adding ? (
          <>
            {schedules.length > 0 && (
              <DialogButton onClick={() => setAdding(false)}>Cancel</DialogButton>
            )}

            <DialogButton
              variant="primary"
              disabled={busy !== null || !draft.task.trim() || full}
              onClick={create}
            >
              {busy === "create" ? "Saving…" : "Schedule it"}
            </DialogButton>
          </>
        ) : (
          <DialogButton onClick={onClose}>Done</DialogButton>
        )
      }
    >
      {/* ------------------------------ */}
      {/* WHAT IS SCHEDULED              */}
      {/* ------------------------------ */}

      {schedules.length > 0 && (
        <div className="space-y-2">
          {schedules.map((schedule) => (
            <div
              key={schedule.id}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2.5"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-[var(--text)]">
                    {schedule.title}
                  </p>

                  <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
                    {schedule.when}
                    {schedule.enabled
                      ? ` · next ${whenText(schedule.nextRunAt)}`
                      : " · paused"}
                  </p>
                </div>

                {schedule.canChange && (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => send(schedule.id, "PATCH", { id: schedule.id, action: "run-now" })}
                      className="rounded-md px-2 py-1 text-[11.5px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40"
                    >
                      Run now
                    </button>

                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() =>
                        send(schedule.id, "PATCH", {
                          id: schedule.id,
                          action: schedule.enabled ? "pause" : "resume",
                        })
                      }
                      className="rounded-md px-2 py-1 text-[11.5px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40"
                    >
                      {schedule.enabled ? "Pause" : "Resume"}
                    </button>

                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => send(schedule.id, "DELETE", undefined, `?id=${schedule.id}`)}
                      className="rounded-md px-2 py-1 text-[11.5px] text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-red-300 disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>

              <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-[var(--text-faint)]">
                {schedule.task}
              </p>

              <p className="mt-1.5 text-[11px] text-[var(--text-faint)]">
                Added by {schedule.addedBy}
                {schedule.lastRunAt &&
                  ` · last ran ${whenText(schedule.lastRunAt)}${
                    schedule.lastRunStatus === "done"
                      ? ", finished"
                      : schedule.lastRunStatus
                        ? `, ${schedule.lastRunStatus}`
                        : ""
                  }`}
              </p>

              {schedule.lastError && (
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-amber-300">
                  {schedule.lastError}
                </p>
              )}
            </div>
          ))}

          {!adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="w-full rounded-lg border border-dashed border-[var(--border-strong)] px-3 py-2 text-[12.5px] text-[var(--text-muted)] transition hover:text-[var(--text)]"
            >
              Add a scheduled task
            </button>
          )}
        </div>
      )}


      {/* ------------------------------ */}
      {/* A NEW ONE                      */}
      {/* ------------------------------ */}

      {adding && (
        <div className={schedules.length > 0 ? "mt-5 border-t border-[var(--border)] pt-4" : ""}>
          {full && limit && (
            <p className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2 text-[12px] leading-relaxed text-[var(--text-muted)]">
              {limit.planLabel} includes {limit.limit} scheduled{" "}
              {limit.limit === 1 ? "task" : "tasks"} per project, and this project
              has {limit.used}. Remove one, or the project owner can upgrade for
              more.
            </p>
          )}

          <p className="mb-1.5 text-[11px] tracking-[0.06em] text-[var(--text-faint)] uppercase">
            Start from an idea
          </p>

          <div className="mb-4 flex flex-wrap gap-1.5">
            {SCHEDULE_IDEAS.map((idea) => (
              <button
                key={idea.title}
                type="button"
                onClick={() =>
                  setDraft({
                    ...EMPTY,
                    ...Object.fromEntries(
                      Object.entries(idea.timing).filter(([, value]) => value !== undefined && value !== null)
                    ),
                    title: idea.title,
                    task: idea.task,
                  } as Draft)
                }
                className={`rounded-lg border px-2.5 py-1 text-[12px] transition ${
                  draft.title === idea.title
                    ? "border-[var(--accent)] text-[var(--text)]"
                    : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
                }`}
              >
                {idea.title}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="mb-1.5 block text-[11px] tracking-[0.06em] text-[var(--text-faint)] uppercase">
              What should the agent do?
            </span>

            <textarea
              rows={3}
              value={draft.task}
              maxLength={2000}
              placeholder="Summarise this week's decisions and list who owes what."
              onChange={(event) => setDraft({ ...draft, task: event.target.value })}
              className={`${field} resize-y leading-relaxed`}
            />
          </label>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="col-span-2 block sm:col-span-1">
              <span className="mb-1.5 block text-[11px] tracking-[0.06em] text-[var(--text-faint)] uppercase">
                How often
              </span>

              <select
                value={draft.cadence}
                onChange={(event) => setDraft({ ...draft, cadence: event.target.value as Cadence })}
                className={field}
              >
                <option value="daily">Every day</option>
                <option value="weekdays">Weekdays</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>

            {draft.cadence === "weekly" && (
              <label className="block">
                <span className="mb-1.5 block text-[11px] tracking-[0.06em] text-[var(--text-faint)] uppercase">
                  On
                </span>

                <select
                  value={draft.weekday}
                  onChange={(event) => setDraft({ ...draft, weekday: Number(event.target.value) })}
                  className={field}
                >
                  {WEEKDAYS.map((day, index) => (
                    <option key={day} value={index}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {draft.cadence === "monthly" && (
              <label className="block">
                <span className="mb-1.5 block text-[11px] tracking-[0.06em] text-[var(--text-faint)] uppercase">
                  Day
                </span>

                <select
                  value={draft.monthDay}
                  onChange={(event) => setDraft({ ...draft, monthDay: Number(event.target.value) })}
                  className={field}
                >
                  {Array.from({ length: 28 }, (_, index) => index + 1).map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="block">
              <span className="mb-1.5 block text-[11px] tracking-[0.06em] text-[var(--text-faint)] uppercase">
                At
              </span>

              <input
                type="time"
                value={draft.timeOfDay}
                onChange={(event) => setDraft({ ...draft, timeOfDay: event.target.value })}
                className={field}
              />
            </label>

            <label className="col-span-2 block sm:col-span-1">
              <span className="mb-1.5 block text-[11px] tracking-[0.06em] text-[var(--text-faint)] uppercase">
                Name
              </span>

              <input
                type="text"
                value={draft.title}
                maxLength={80}
                placeholder="Optional"
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                className={field}
              />
            </label>
          </div>

          <p className="mt-3 text-[12px] leading-relaxed text-[var(--text-muted)]">
            {preview}, {timezone.replace(/_/g, " ")} time. It uses your AI
            allowance or your key, and your connected apps.
          </p>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-[12px] text-red-200">
          {error}
        </p>
      )}
    </Dialog>
  );
}
