"use client";

import { useCallback, useEffect, useState } from "react";

import { cachedJson, peekJson } from "@/lib/net/cache";


// ==========================================
// SKILLS
// ==========================================
//
// Add a GitHub repo of skills (folders with a SKILL.md -
// the format Claude skills use) and every agent in the
// project can use them, on whatever model it runs. The
// agent sees each skill's name and description and reads
// the full instructions only when a task calls for it.
//

type Skill = {
  id: string;
  name: string;
  description: string;
  source: string | null;
  enabled: boolean;
};

export default function SkillsSection({ projectId }: { projectId: string | null }) {
  const base = projectId ? `/api/projects/${projectId}/skills` : "";

  // Cached from a previous open, so the tab shows the
  // skills at once; a fresh read follows behind.
  const known = base
    ? peekJson<{ skills?: Skill[]; canManage?: boolean }>(base)
    : undefined;

  const [skills, setSkills] = useState<Skill[]>(known?.skills ?? []);
  const [canManage, setCanManage] = useState(Boolean(known?.canManage));

  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(Boolean(projectId) && !known);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  // `force` re-reads past the cache, after a change.
  const load = useCallback(async (force = false) => {
    if (!base) {
      setLoading(false);

      return;
    }

    try {
      const data = (await cachedJson(base, { force })) as {
        error?: string;
        skills?: Skill[];
        canManage?: boolean;
      };

      if (data.error) {
        throw new Error(data.error);
      }

      setSkills(data.skills ?? []);
      setCanManage(Boolean(data.canManage));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load skills.");
    } finally {
      setLoading(false);
    }
  }, [base]);

  // With nothing cached, join the read Settings already
  // started on open; with something cached, show it and
  // refresh behind it, so a skill a teammate added shows
  // up without a reload.
  const cached = Boolean(known);

  useEffect(() => {
    void Promise.resolve().then(() => load(cached));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  async function call(init: RequestInit, query = "") {
    setBusy(true);
    setError("");
    setNote("");

    try {
      const response = await fetch(`${base}${query}`, {
        ...init,
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error ?? "That did not work.");
      }

      await load(true);

      return data;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.");

      return null;
    } finally {
      setBusy(false);
    }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();

    if (!url.trim() || busy) {
      return;
    }

    const data = await call({ method: "POST", body: JSON.stringify({ url: url.trim() }) });

    if (data?.added) {
      setUrl("");
      setNote(
        `Added ${data.added.length} ${data.added.length === 1 ? "skill" : "skills"}: ${data.added.join(", ")}.`
      );
    }
  }

  if (!projectId) {
    return (
      <p className="text-[12.5px] text-[var(--text-faint)]">Select a project to see its skills.</p>
    );
  }

  return (
    <div>
      <p className="text-[12.5px] leading-relaxed text-[var(--text-muted)]">
        Skills are expert instructions for a kind of work - a landing page in your style, a client
        report, a code review checklist. Add a GitHub repo with SKILL.md files (the format Claude
        skills use) and every agent here uses them when a task matches, on any model.
      </p>

      {canManage && (
        <form onSubmit={add} className="mt-4">
          <span className="mb-1.5 block text-[10px] tracking-[0.12em] text-[var(--text-faint)] uppercase">
            Add from GitHub
          </span>

          <div className="flex gap-2">
            <input
              type="text"
              value={url}
              disabled={busy}
              placeholder="github.com/owner/repo or a folder in it"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => setUrl(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2 text-[13px] text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--border-strong)]"
            />

            <button
              type="submit"
              disabled={busy || !url.trim()}
              className="shrink-0 rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--bg)] transition hover:opacity-90 disabled:opacity-40"
            >
              {busy ? "Adding…" : "Add"}
            </button>
          </div>

          <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-faint)]">
            Every SKILL.md under the link is added. Adding the same repo again refreshes them. Private
            repos need your GitHub account connected.
          </p>
        </form>
      )}

      {note && (
        <p className="mt-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2 text-[12px] leading-relaxed text-[var(--text-muted)]">
          {note}
        </p>
      )}

      {error && (
        <p className="mt-2.5 rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-[12px] leading-relaxed text-red-200">
          {error}
        </p>
      )}

      <p className="mt-6 mb-1.5 text-[10px] tracking-[0.12em] text-[var(--text-faint)] uppercase">
        In this project
      </p>

      {loading ? (
        <p className="text-[12.5px] text-[var(--text-faint)]">Loading…</p>
      ) : skills.length === 0 ? (
        <p className="text-[12.5px] text-[var(--text-faint)]">No skills yet.</p>
      ) : (
        <div className="space-y-1">
          {skills.map((skill) => (
            <div
              key={skill.id}
              className="group flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-[var(--bg-hover)]"
            >
              <div className="min-w-0 flex-1">
                <p
                  className={`truncate text-[13px] ${
                    skill.enabled ? "text-[var(--text)]" : "text-[var(--text-faint)] line-through"
                  }`}
                >
                  {skill.source ? (
                    <a href={skill.source} target="_blank" rel="noreferrer" className="hover:underline">
                      {skill.name}
                    </a>
                  ) : (
                    skill.name
                  )}
                </p>

                <p className="line-clamp-2 text-[11.5px] leading-relaxed text-[var(--text-faint)]">
                  {skill.description}
                </p>
              </div>

              {canManage && (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      call({
                        method: "PATCH",
                        body: JSON.stringify({ id: skill.id, enabled: !skill.enabled }),
                      })
                    }
                    className="rounded px-1.5 py-0.5 text-[11.5px] text-[var(--text-faint)] transition hover:text-[var(--text)] disabled:opacity-40"
                  >
                    {skill.enabled ? "Turn off" : "Turn on"}
                  </button>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Remove the ${skill.name} skill?`)) {
                        void call({ method: "DELETE" }, `?id=${skill.id}`);
                      }
                    }}
                    className="rounded px-1.5 py-0.5 text-[11.5px] text-[var(--text-faint)] opacity-0 transition group-hover:opacity-100 hover:text-red-300 [@media(hover:none)]:opacity-100 disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
