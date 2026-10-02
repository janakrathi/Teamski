"use client";

import { useEffect, useState } from "react";

import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

import {
  clearProfileCache,
  loadProfile,
  peekProfile,
  updateProfile,
} from "@/lib/account/profile";

import { Dialog, DialogButton } from "@/components/ui/Dialog";


// ==========================================
// ACCOUNT
// ==========================================
//
// Everyone in this app has been their email
// address. The sidebar said someone@example.com,
// DMs were addressed to an inbox, and the handle
// you typed after an @ was whatever survived
// stripping the domain.
//
// A name is what people read. A username is what
// they type. They are different jobs, so they are
// two fields.
//

type Profile = {
  id: string;
  email: string;
  display_name: string | null;
  username: string | null;
};


function Field({
  label,
  hint,
  prefix,
  ...input
}: {
  label: string;
  hint?: string;
  prefix?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="mt-4 block first:mt-0">
      <span className="mb-1.5 block text-[10px] tracking-[0.12em] text-[var(--text-faint)] uppercase">
        {label}
      </span>

      <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] transition focus-within:border-[var(--border-strong)]">
        {prefix && (
          <span className="pl-3 text-[13px] text-[var(--text-faint)]">
            {prefix}
          </span>
        )}

        <input
          {...input}
          className="w-full bg-transparent px-3 py-2 text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] disabled:opacity-60"
        />
      </div>

      {hint && (
        <span className="mt-1.5 block text-[11.5px] leading-relaxed text-[var(--text-faint)]">
          {hint}
        </span>
      )}
    </label>
  );
}


export default function AccountSection() {
  const router = useRouter();

  // What the shared cache already holds, so a panel
  // opened after the app primed it shows the account
  // straight away instead of a loading line.
  const known = peekProfile();

  const [profile, setProfile] =
    useState<Profile | null>(
      (known?.profile as Profile | null) ?? null
    );

  const [name, setName] = useState(
    known?.profile?.display_name ?? ""
  );
  const [username, setUsername] = useState(
    known?.profile?.username ?? ""
  );

  const [loading, setLoading] = useState(!known);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const [deleting, setDeleting] = useState(false);


  useEffect(() => {
    let cancelled = false;

    // Reuses the cached fetch when there is one, so
    // reopening settings costs nothing.
    loadProfile()
      .then((data) => {
        if (cancelled || !data.profile) {
          return;
        }

        setProfile(data.profile as Profile);
        setName(data.profile.display_name ?? "");
        setUsername(data.profile.username ?? "");

        if (data.needsMigration) {
          setError(
            "Run supabase/migrations/0011_identity.sql to enable usernames."
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(
            "Could not load your profile."
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);


  const dirty =
    profile !== null &&
    (name !== (profile.display_name ?? "") ||
      username !== (profile.username ?? ""));


  async function save() {
    setSaving(true);
    setError("");
    setSaved(false);

    try {
      const response = await fetch(
        "/api/profile",
        {
          method: "PATCH",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            display_name: name,
            username,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Could not save."
        );
      }

      setProfile(data.profile);
      updateProfile(data.profile);
      setSaved(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save."
      );
    } finally {
      setSaving(false);
    }
  }


  async function signOut() {
    clearProfileCache();

    await createClient().auth.signOut();

    // The cookie is gone, so refresh is what
    // makes the server agree - without it the
    // already-rendered page keeps its data.

    router.push("/login");
    router.refresh();
  }


  if (loading) {
    return (
      <p className="text-[12.5px] text-[var(--text-faint)]">
        Loading your account…
      </p>
    );
  }


  return (
    <div>
      <Field
        label="Name"
        placeholder="Janak"
        value={name}
        maxLength={60}
        onChange={(event) => {
          setName(event.target.value);
          setSaved(false);
        }}
        hint="What teammates see beside your messages."
      />

      <Field
        label="Username"
        prefix="@"
        placeholder="janak"
        value={username}
        maxLength={24}
        onChange={(event) => {
          setUsername(event.target.value);
          setSaved(false);
        }}
        hint="What they type to mention you. Letters, numbers, dots, dashes and underscores."
      />

      <Field
        label="Email"
        value={profile?.email ?? ""}
        disabled
        readOnly
        hint="Changing the address you sign in with is not built yet."
      />

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--bg)] transition hover:opacity-90 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>

        {saved && (
          <span className="text-[12px] text-[var(--text-muted)]">
            Saved.
          </span>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-[12px] leading-relaxed text-red-200">
          {error}
        </p>
      )}


      {/* ---------------------------- */}
      {/* SESSION                      */}
      {/* ---------------------------- */}

      <div className="mt-8 flex items-center gap-2 border-t border-[var(--border)] pt-4">
        <button
          type="button"
          onClick={signOut}
          className="rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-[12.5px] text-[var(--text-muted)] transition hover:text-[var(--text)]"
        >
          Sign out
        </button>

        <button
          type="button"
          onClick={() => setDeleting(true)}
          className="ml-auto rounded-md px-3 py-1.5 text-[12.5px] text-red-300/80 transition hover:bg-red-950/30 hover:text-red-200"
        >
          Delete account
        </button>
      </div>

      {deleting && (
        <DeleteAccount
          email={profile?.email ?? ""}
          onClose={() => setDeleting(false)}
        />
      )}
    </div>
  );
}


// ==========================================
// DELETE ACCOUNT
// ==========================================
//
// Says exactly what goes and what stays before
// anything happens, and asks for the word to be
// typed. A button that deletes everything should
// not be pressable by a stray click.
//

function DeleteAccount({
  email,
  onClose,
}: {
  email: string;
  onClose: () => void;
}) {
  const router = useRouter();

  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ready = typed.trim().toLowerCase() === "delete";

  async function confirm() {
    if (!ready || busy) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: typed }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error || "Could not delete your account."
        );
      }

      // The sign-in no longer exists; clear what the
      // browser still holds, and leave.

      await createClient().auth.signOut().catch(() => {});

      try {
        localStorage.clear();
      } catch {
        // Nothing to clear.
      }

      router.push("/");
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not delete your account."
      );

      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title="Delete your account?"
      description="This cannot be undone."
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <DialogButton
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </DialogButton>

          <button
            type="button"
            onClick={confirm}
            disabled={!ready || busy}
            className="rounded-md bg-red-600 px-3 py-1.5 text-[12.5px] font-medium text-white transition hover:bg-red-500 disabled:opacity-40"
          >
            {busy ? "Deleting…" : "Delete account"}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
        <div>
          <p className="font-medium text-[var(--text)]">Deleted</p>

          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>Your account{email ? ` (${email})` : ""} and profile</li>
            <li>Messages you wrote in channels and DMs, and files you uploaded</li>
            <li>Your API keys, including any you shared with a project</li>
            <li>Connected apps and your plan</li>
            <li>Projects where you are the only member</li>
          </ul>
        </div>

        <div>
          <p className="font-medium text-[var(--text)]">Kept</p>

          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>
              Projects other people are in. They are handed to another
              member, and move to that person&apos;s plan.
            </li>
          </ul>
        </div>

        <label className="block pt-1">
          <span className="mb-1.5 block text-[12px] text-[var(--text-faint)]">
            Type <span className="font-medium text-[var(--text)]">delete</span> to confirm
          </span>

          <input
            type="text"
            value={typed}
            disabled={busy}
            autoComplete="off"
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void confirm();
              }
            }}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-red-900/60"
          />
        </label>

        {error && (
          <p className="text-[12.5px] text-red-300">{error}</p>
        )}
      </div>
    </Dialog>
  );
}
