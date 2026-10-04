"use client";

import { useEffect, useState } from "react";

import { Dialog, DialogButton } from "@/components/ui/Dialog";

import type { Channel } from "@/components/types";


// ==========================================
// WHO CAN SEE A CHANNEL
// ==========================================
//
// Open: everyone in the project, viewers included (they
// read, never post). Private: only the people ticked
// here. Owners and admins always see every channel, so
// they are shown ticked and fixed.
//

type Person = {
  id: string;
  email: string;
  display_name?: string | null;
  username?: string | null;
  role?: string;
  you?: boolean;
};

export default function ChannelAccessDialog({
  projectId,
  channel,
  onClose,
  onSaved,
}: {
  projectId: string;
  channel: Channel | null;
  onClose: () => void;
  onSaved: (channel: Channel) => void;
}) {
  const [people, setPeople] = useState<Person[]>([]);
  const [restricted, setRestricted] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const channelId = channel?.id ?? null;

  useEffect(() => {
    if (!channelId) {
      return;
    }

    let cancelled = false;

    (async () => {
      setLoading(true);
      setError("");

      try {
        const [members, access] = await Promise.all([
          fetch(`/api/projects/${projectId}/members?includeSelf=true`).then((r) => r.json()),
          fetch(`/api/projects/${projectId}/channels/access?channelId=${channelId}`).then((r) =>
            r.json()
          ),
        ]);

        if (cancelled) {
          return;
        }

        if (access.error) {
          throw new Error(access.error);
        }

        setPeople((members.members ?? []) as Person[]);
        setRestricted(Boolean(access.restricted));
        setChosen(new Set((access.userIds ?? []) as string[]));
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not load who can see it.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, channelId]);

  async function save() {
    if (!channel) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      const response = await fetch(`/api/projects/${projectId}/channels/access`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: channel.id,
          restricted,
          userIds: [...chosen],
        }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error ?? "Could not save.");
      }

      onSaved({ ...channel, restricted });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  const runs = (person: Person) => person.role === "owner" || person.role === "admin";

  // Who sees it without being ticked: owners and admins
  // always; members too while the channel is open.
  const seesAnyway = (person: Person) => runs(person) || !restricted;

  const toggle = (id: string) =>
    setChosen((previous) => {
      const next = new Set(previous);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });

  return (
    <Dialog
      open={Boolean(channel)}
      onClose={onClose}
      title={channel ? `Who can see #${channel.name}` : "Who can see it"}
      description="Viewers can read every open channel and the private ones they are ticked on, but never post. Owners and admins see every channel."
      footer={
        <>
          <DialogButton onClick={onClose}>Cancel</DialogButton>
          <DialogButton variant="primary" disabled={saving || loading} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </DialogButton>
        </>
      }
    >
      {loading ? (
        <p className="text-[12.5px] text-[var(--text-faint)]">Loading…</p>
      ) : (
        <div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: false, label: "Open", hint: "Everyone in the project" },
              { value: true, label: "Private", hint: "Only the people ticked" },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => setRestricted(option.value)}
                className={`rounded-lg border px-3 py-2 text-left transition ${
                  restricted === option.value
                    ? "border-[var(--accent)] bg-[var(--bg-hover)]"
                    : "border-[var(--border)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                <span className="block text-[13px] text-[var(--text)]">{option.label}</span>
                <span className="block text-[11.5px] text-[var(--text-faint)]">{option.hint}</span>
              </button>
            ))}
          </div>

          <p className="mt-4 mb-1.5 text-[10px] tracking-[0.12em] text-[var(--text-faint)] uppercase">
            People
          </p>

          <div className="max-h-64 space-y-0.5 overflow-y-auto">
            {people.map((person) => {
              const fixed = seesAnyway(person);
              const ticked = fixed || chosen.has(person.id);

              return (
                <label
                  key={person.id}
                  className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition ${
                    fixed ? "opacity-60" : "cursor-pointer hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={ticked}
                    disabled={fixed}
                    onChange={() => toggle(person.id)}
                    className="accent-[var(--accent)]"
                  />

                  <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text)]">
                    {person.display_name || person.email}
                    {person.you && (
                      <span className="ml-1.5 text-[11px] text-[var(--text-faint)]">you</span>
                    )}
                  </span>

                  <span className="shrink-0 text-[11px] text-[var(--text-faint)]">
                    {person.role ?? "member"}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-[12px] leading-relaxed text-red-200">
          {error}
        </p>
      )}
    </Dialog>
  );
}
