"use client";

import { useEffect, useState } from "react";


// ==========================================
// ACTIVITY LOG
// ==========================================
//
// Who changed what in the project - people, roles,
// channel access, shared keys, skills, exports - for
// its owner and admins. Read from /api/projects/[id]/audit.
//

type Entry = {
  id: number;
  actor: string;
  action: string;
  target: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

function describe(entry: Entry) {
  const target = entry.target ?? "";
  const details = entry.details ?? {};
  const role = typeof details.role === "string" ? details.role : "";

  switch (entry.action) {
    case "member.add":
      return `added ${target}${role ? ` as ${role}` : ""}`;
    case "member.invite":
      return `invited ${target}${role ? ` as ${role}` : ""}`;
    case "member.role":
      return `made ${target} ${String(details.to ?? "")} (was ${String(details.from ?? "")})`;
    case "member.remove":
      return `removed ${target}`;
    case "member.leave":
      return "left the project";
    case "invite.withdraw":
      return `withdrew the invite to ${target}`;
    case "channel.create":
      return `created ${target}`;
    case "channel.rename":
      return `renamed #${String(details.from ?? "")} to ${target}`;
    case "channel.delete":
      return `deleted ${target}`;
    case "channel.access":
      return `made ${target} ${details.restricted ? "private" : "open"} (${Number(
        details.added ?? 0
      )} added, ${Number(details.removed ?? 0)} removed)`;
    case "key.add":
      return `saved the shared ${target} key`;
    case "key.remove":
      return `removed the shared ${target} key`;
    case "schedule.add":
      return `scheduled "${target}"`;
    case "schedule.remove":
      return `removed the schedule "${target}"`;
    case "skill.add":
      return `added the skill ${target}`;
    case "skill.remove":
      return `removed the skill ${target}`;
    case "skill.toggle":
      return `${details.enabled ? "turned on" : "turned off"} the skill ${target}`;
    case "skill.refresh":
      return `refreshed the skills from GitHub (${Number(details.updated ?? 0)} changed)`;
    case "project.export":
      return "exported the project";
    default:
      return `${entry.action}${target ? ` ${target}` : ""}`;
  }
}

function when(iso: string) {
  const date = new Date(iso);

  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ActivityLog({
  projectId,
  refreshKey = 0,
}: {
  projectId: string;

  // Changes when something in People changed.
  refreshKey?: number;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");

  async function load(before?: string) {
    try {
      const response = await fetch(
        `/api/projects/${projectId}/audit${before ? `?before=${encodeURIComponent(before)}` : ""}`
      );

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error ?? "Could not load the activity log.");
      }

      const page = (data.entries ?? []) as Entry[];

      setEntries((previous) => (before ? [...previous, ...page] : page));
      setMore(page.length === 50);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the activity log.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, refreshKey]);

  return (
    <div className="mt-8 border-t border-[var(--border)] pt-5">
      <p className="mb-1.5 text-[10px] tracking-[0.12em] text-[var(--text-faint)] uppercase">
        Activity
      </p>

      {loading ? (
        <p className="text-[12.5px] text-[var(--text-faint)]">Loading…</p>
      ) : error ? (
        <p className="text-[12px] leading-relaxed text-[var(--text-faint)]">{error}</p>
      ) : entries.length === 0 ? (
        <p className="text-[12.5px] text-[var(--text-faint)]">
          Nothing yet. Changes to people, roles, channel access, shared keys and skills show up
          here.
        </p>
      ) : (
        <div className="space-y-1">
          {entries.map((entry) => (
            <div key={entry.id} className="flex gap-3 px-1 py-1 text-[12.5px] leading-relaxed">
              <span className="w-24 shrink-0 text-[11.5px] text-[var(--text-faint)]">
                {when(entry.created_at)}
              </span>

              <span className="min-w-0 flex-1 text-[var(--text-muted)]">
                <span className="text-[var(--text)]">{entry.actor}</span> {describe(entry)}
              </span>
            </div>
          ))}

          {more && (
            <button
              type="button"
              onClick={() => load(entries[entries.length - 1]?.created_at)}
              className="mt-1 rounded px-1 text-[12px] text-[var(--text-faint)] transition hover:text-[var(--text)]"
            >
              Show older
            </button>
          )}
        </div>
      )}
    </div>
  );
}
