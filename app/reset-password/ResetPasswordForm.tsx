"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import Link from "next/link";

import Logo from "@/components/ui/Logo";

import Aurora from "@/components/landing/Aurora";

import SignalField from "@/components/landing/SignalField";

import { SITE_THEME } from "@/components/landing/Site";

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
    <main
      style={SITE_THEME}
      className="relative isolate flex min-h-screen shrink-0 items-center justify-center overflow-hidden px-6 pt-20 pb-12"
    >
      {/* The same light purple glow and signal lines as
          sign-in, quiet in the middle where the form is. */}
      <Aurora top={0.24} rest={0.24} />

      <SignalField calm="center" />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_42%_60%_at_50%_50%,rgba(0,0,0,0.92),transparent_80%)]"
      />

      <Link
        href="/"
        className="absolute top-5 left-6 z-10 flex items-center gap-2.5 text-[15px] font-medium tracking-[-0.01em] text-[#ededed]"
      >
        <Logo size={28} />
        Teamski
      </Link>

      <div className="t-modal relative w-full max-w-[380px] rounded-2xl border border-white/10 bg-black/85 px-6 py-8 shadow-[0_30px_80px_rgba(0,0,0,0.6)] sm:px-7">
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
