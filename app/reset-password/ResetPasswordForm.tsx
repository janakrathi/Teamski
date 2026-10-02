"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import Logo from "@/components/ui/Logo";

import { Field } from "@/app/login/LoginForm";

import { createClient } from "@/lib/supabase/client";


export default function ResetPasswordForm() {
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();

    setError("");

    // Caught here rather than by Supabase, because
    // a typo in a password nobody can see is the
    // likeliest mistake on this page.

    if (password !== again) {
      setError("The two passwords do not match.");
      return;
    }

    setBusy(true);

    const { error } = await createClient().auth.updateUser({
      password,
    });

    setBusy(false);

    if (error) {
      setError(
        /different from the old/i.test(error.message)
          ? "That is your current password. Choose a different one."
          : /session|expired|not authenticated/i.test(error.message)
            ? "This reset link has expired. Ask for a new one from the sign-in page."
            : error.message
      );

      return;
    }

    setDone(true);

    // A moment to read that it worked.
    setTimeout(() => {
      router.push("/");
      router.refresh();
    }, 1200);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-6 py-12">
      <div className="w-full max-w-[360px]">
        <div className="mb-8 text-center">
          <Logo size={64} className="mx-auto mb-4" />

          <h1 className="text-[19px] font-medium tracking-[-0.01em] text-[var(--text)]">
            Choose a new password
          </h1>

          <p className="mt-1.5 text-[13px] text-[var(--text-muted)]">
            You will stay signed in on this device.
          </p>
        </div>

        <form onSubmit={save} className="space-y-3">
          <Field
            label="New password"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            placeholder="At least 6 characters"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          <Field
            label="Type it again"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            placeholder="The same password"
            value={again}
            onChange={(event) => setAgain(event.target.value)}
          />

          <button
            type="submit"
            disabled={busy || done}
            className="w-full rounded-lg bg-[var(--accent)] px-3 py-2.5 text-[13.5px] font-medium text-[var(--bg)] transition hover:opacity-90 disabled:opacity-50"
          >
            {done ? "Saved" : busy ? "Saving…" : "Save new password"}
          </button>
        </form>

        {error && (
          <p className="mt-4 rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2.5 text-[12.5px] leading-relaxed text-red-200">
            {error}
          </p>
        )}

        {done && (
          <p className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2.5 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
            Your password is changed. Taking you to Teamski…
          </p>
        )}

      </div>
    </main>
  );
}
