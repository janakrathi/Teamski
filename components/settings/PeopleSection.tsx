"use client";

import { useCallback, useEffect, useState } from "react";

import { cachedJson, peekJson } from "@/lib/net/cache";

import ActivityLog from "./ActivityLog";


// ==========================================
// PEOPLE
// ==========================================
//
// There was no way to get a second person into a
// project. Both existing members are there
// because somebody wrote the row by hand.
//
// Invites go by email, because that is all you
// know about somebody who has not signed up. If
// they already have an account they join now; if
// not, the invite waits for them and is claimed
// the first time they open the app.
//

type Person = {
  id: string;
  email: string;
  display_name?: string | null;
  username?: string | null;
  role?: string;
  you?: boolean;
};

type Invite = {
  id: string;
  email: string;
  role: string;
  created_at: string;
};


function Avatar({ label }: { label: string }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bg-raised)] text-[10px] font-medium text-[var(--text-muted)]">
      {label.charAt(0).toUpperCase()}
    </span>
  );
}


export default function PeopleSection({
  projectId,
}: {
  projectId: string | null;
}) {
  const membersUrl = projectId
    ? `/api/projects/${projectId}/members?includeSelf=true`
    : "";

  // Cached from a previous open, so the tab shows the
  // members at once instead of reloading them.
  const known = membersUrl
    ? peekJson<{ members?: Person[]; invites?: Invite[] }>(
        membersUrl
      )
    : undefined;

  const [people, setPeople] = useState<Person[]>(
    known?.members ?? []
  );

  const [invites, setInvites] = useState<Invite[]>(
    known?.invites ?? []
  );

  const [email, setEmail] = useState("");

  // What new people join as.
  const [joinAs, setJoinAs] = useState<"member" | "viewer">("member");

  const [loading, setLoading] = useState(
    Boolean(projectId) && !known
  );
  const [busy, setBusy] = useState(false);

  // Only while people are being added, so a role change
  // or removal does not relabel the Add button.
  const [adding, setAdding] = useState(false);

  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  // Bumped after every change, so the activity log
  // below re-reads and shows it straight away.
  const [changes, setChanges] = useState(0);


  // `force` re-reads past the cache, after a change.
  const load = useCallback(
    async (force = false) => {
      if (!membersUrl) {
        setLoading(false);

        return;
      }

      try {
        const data = (await cachedJson(membersUrl, {
          force,
        })) as {
          error?: string;
          members?: Person[];
          invites?: Invite[];
        };

        if (data.error) {
          throw new Error(data.error);
        }

        setPeople(data.members ?? []);
        setInvites(data.invites ?? []);

        if (force) {
          setChanges((count) => count + 1);
        }
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not load people."
        );
      } finally {
        setLoading(false);
      }
    },
    [membersUrl]
  );


  useEffect(() => {
    // Off the effect body, so the first load
    // does not land as a second render pass.

    void Promise.resolve().then(() => load());
  }, [load]);


  // One person or many: emails and @usernames
  // separated by commas, spaces or new lines, each
  // added with the role picked beside the box.
  async function invite(event?: React.FormEvent) {
    event?.preventDefault();

    const entries = [
      ...new Set(
        email
          .split(/[\s,;]+/)
          .map((entry) => entry.trim())
          .filter(Boolean)
      ),
    ];

    if (entries.length === 0 || busy || !projectId) {
      return;
    }

    if (entries.length > 50) {
      setError("Add up to 50 people at a time.");

      return;
    }

    setBusy(true);
    setAdding(true);
    setError("");
    setNote("");

    const done: string[] = [];
    const failed: string[] = [];
    let lastMessage = "";

    for (const entry of entries) {
      try {
        const response = await fetch(
          `/api/projects/${projectId}/members`,
          {
            method: "POST",

            headers: {
              "Content-Type": "application/json",
            },

            body: JSON.stringify({
              // An email or a @username; the server
              // works out which.
              query: entry,
              role: joinAs,
            }),
          }
        );

        const data = await response.json();

        if (!response.ok) {
          failed.push(`${entry}: ${data.error || "could not be added"}`);

          // The plan is full: the rest would fail too.
          if (data.enterprise) {
            break;
          }

          continue;
        }

        done.push(entry);
        lastMessage = data.message ?? "";
      } catch {
        failed.push(`${entry}: could not be added`);
      }
    }

    setEmail(failed.length > 0 ? entries.filter((entry) => !done.includes(entry)).join("\n") : "");

    if (entries.length === 1) {
      if (done.length === 1) {
        setNote(lastMessage || "Invited.");
      } else {
        setError(failed[0]?.replace(/^[^:]+: /, "") ?? "Could not invite them.");
      }
    } else {
      if (done.length > 0) {
        setNote(
          `Added or invited ${done.length} ${done.length === 1 ? "person" : "people"} as ${
            joinAs === "viewer" ? "viewers" : "members"
          }.`
        );
      }

      if (failed.length > 0) {
        setError(failed.join("\n"));
      }
    }

    setBusy(false);
    setAdding(false);

    await load(true);
  }


  async function changeRole(
    userId: string,
    role: string
  ) {
    setBusy(true);
    setError("");
    setNote("");

    try {
      const response = await fetch(
        `/api/projects/${projectId}/members`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ userId, role }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Could not change the role."
        );
      }

      await load(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not change the role."
      );
    } finally {
      setBusy(false);
    }
  }


  async function remove(
    query: string,
    label: string
  ) {
    setBusy(true);
    setError("");
    setNote("");

    try {
      const response = await fetch(
        `/api/projects/${projectId}/members?${query}`,
        { method: "DELETE" }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            `Could not remove ${label}.`
        );
      }

      await load(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : `Could not remove ${label}.`
      );
    } finally {
      setBusy(false);
    }
  }


  if (!projectId) {
    return (
      <p className="text-[12.5px] text-[var(--text-faint)]">
        Select a project to see who is in it.
      </p>
    );
  }

  // What the viewer may do. Only an owner or admin
  // changes roles or removes people.
  const myRole = people.find(
    (person) => person.you
  )?.role;

  const canManage =
    myRole === "owner" || myRole === "admin";


  return (
    <div>

      {/* ---------------------------- */}
      {/* INVITE                       */}
      {/* ---------------------------- */}

      <form onSubmit={invite}>
        <span className="mb-1.5 block text-[10px] tracking-[0.12em] text-[var(--text-faint)] uppercase">
          Add someone
        </span>

        <div className="flex items-start gap-2">
          <textarea
            value={email}
            disabled={busy}
            rows={email.includes("\n") ? 4 : 1}
            placeholder="teammate@company.com or @username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) =>
              setEmail(event.target.value)
            }
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void invite();
              }
            }}
            className="min-w-0 flex-1 resize-none rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2 text-[13px] text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--border-strong)]"
          />

          <select
            value={joinAs}
            disabled={busy}
            onChange={(event) =>
              setJoinAs(event.target.value === "viewer" ? "viewer" : "member")
            }
            aria-label="Join as"
            className="shrink-0 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-2 py-2 text-[12.5px] text-[var(--text-muted)] outline-none focus:border-[var(--border-strong)]"
          >
            <option value="member">Member</option>
            <option value="viewer">Viewer</option>
          </select>

          <button
            type="submit"
            disabled={busy || !email.trim()}
            className="shrink-0 rounded-md bg-[var(--accent)] px-3 py-2 text-[12.5px] font-medium text-[var(--bg)] transition hover:opacity-90 disabled:opacity-40"
          >
            {adding ? "Adding…" : "Add"}
          </button>
        </div>

        <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-faint)]">
          By email, or by @username if they are already on Teamski. Paste
          several at once, separated by commas or new lines. Viewers read
          every open channel, and private ones you tick them on (channel ⋯ →
          Who can see it), but never post.
        </p>
      </form>

      {note && (
        <p className="mt-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2 text-[12px] leading-relaxed text-[var(--text-muted)]">
          {note}
        </p>
      )}

      {error && (
        <p className="mt-2.5 whitespace-pre-line rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-[12px] leading-relaxed text-red-200">
          {error}
        </p>
      )}


      {/* ---------------------------- */}
      {/* WHO IS HERE                  */}
      {/* ---------------------------- */}

      <p className="mt-6 mb-1.5 text-[10px] tracking-[0.12em] text-[var(--text-faint)] uppercase">
        In this project
      </p>

      {loading ? (
        <p className="text-[12.5px] text-[var(--text-faint)]">
          Loading…
        </p>
      ) : (
        <div className="space-y-1">
          {people.map((person) => {
            const label =
              person.display_name ||
              person.email;

            return (
              <div
                key={person.id}
                className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-[var(--bg-hover)]"
              >
                <Avatar label={label} />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-[var(--text)]">
                    {label}

                    {person.you && (
                      <span className="ml-1.5 text-[11px] text-[var(--text-faint)]">
                        you
                      </span>
                    )}
                  </p>

                  <p className="truncate text-[11.5px] text-[var(--text-faint)]">
                    {person.username
                      ? `@${person.username}`
                      : person.email}
                  </p>
                </div>

                {person.role === "owner" ? (
                  <span className="shrink-0 text-[11px] text-[var(--text-faint)]">
                    owner
                  </span>
                ) : (
                  <div className="flex shrink-0 items-center gap-1.5">
                    {/* An owner or admin sets the role
                        of anyone but themselves and the
                        owner; everyone else just sees
                        what it is. */}
                    {canManage && !person.you ? (
                      <select
                        value={person.role ?? "member"}
                        disabled={busy}
                        onChange={(event) =>
                          changeRole(
                            person.id,
                            event.target.value
                          )
                        }
                        aria-label={`Role for ${label}`}
                        className="rounded-md border border-[var(--border)] bg-[var(--bg-raised)] px-1.5 py-0.5 text-[11px] text-[var(--text-muted)] outline-none transition focus:border-[var(--border-strong)] disabled:opacity-40"
                      >
                        <option value="member">
                          Member
                        </option>
                        <option value="admin">
                          Admin
                        </option>
                        <option value="viewer">
                          Viewer
                        </option>
                      </select>
                    ) : (
                      <span className="text-[11px] text-[var(--text-faint)]">
                        {person.role ?? "member"}
                      </span>
                    )}

                    {(person.you || canManage) && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          remove(
                            `userId=${person.id}`,
                            label
                          )
                        }
                        className="rounded px-1.5 py-0.5 text-[11.5px] text-[var(--text-faint)] opacity-0 transition group-hover:opacity-100 hover:text-red-300 [@media(hover:none)]:opacity-100 disabled:opacity-40"
                      >
                        {person.you
                          ? "Leave"
                          : "Remove"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}


      {/* ---------------------------- */}
      {/* WAITING TO SIGN UP           */}
      {/* ---------------------------- */}

      {invites.length > 0 && (
        <>
          <p className="mt-6 mb-1.5 text-[10px] tracking-[0.12em] text-[var(--text-faint)] uppercase">
            Invited
          </p>

          <div className="space-y-1">
            {invites.map((pending) => (
              <div
                key={pending.id}
                className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-[var(--bg-hover)]"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-[var(--border-strong)] text-[10px] text-[var(--text-faint)]">
                  {pending.email
                    .charAt(0)
                    .toUpperCase()}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-[var(--text-muted)]">
                    {pending.email}
                  </p>

                  <p className="text-[11.5px] text-[var(--text-faint)]">
                    Joins when they sign up
                  </p>
                </div>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    remove(
                      `inviteId=${pending.id}`,
                      pending.email
                    )
                  }
                  className="shrink-0 rounded px-1.5 py-0.5 text-[11.5px] text-[var(--text-faint)] opacity-0 transition group-hover:opacity-100 hover:text-red-300 [@media(hover:none)]:opacity-100 disabled:opacity-40"
                >
                  Withdraw
                </button>
              </div>
            ))}
          </div>
        </>
      )}


      {/* ---------------------------- */}
      {/* TAKE IT WITH YOU             */}
      {/* ---------------------------- */}

      {canManage && (
        <div className="mt-8 border-t border-[var(--border)] pt-5">
          <p className="mb-1.5 text-[10px] tracking-[0.12em] text-[var(--text-faint)] uppercase">
            Export
          </p>

          <p className="text-[12.5px] leading-relaxed text-[var(--text-muted)]">
            Download everything in this project as one file: members,
            channels, every message, what the agents remember, schedules and
            the files they wrote.
          </p>

          <a
            href={`/api/projects/${projectId}/export`}
            download
            className="mt-3 inline-block rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--text)] transition hover:bg-[var(--bg-hover)]"
          >
            Export project
          </a>
        </div>
      )}

      {canManage && <ActivityLog projectId={projectId} refreshKey={changes} />}

    </div>
  );
}
