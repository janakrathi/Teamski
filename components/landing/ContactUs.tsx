"use client";

import { useState } from "react";

import { Dialog, DialogButton } from "@/components/ui/Dialog";

import { TOPICS } from "@/lib/contact";


// ==========================================
// CONTACT US
// ==========================================
//
// The front page footer's way to reach the team: a
// short form instead of an email address. What it
// sends lands in the Google Sheet and the admins'
// inbox (app/api/contact).
//

const FIELD =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2 text-[13.5px] text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--border-strong)] disabled:opacity-60";

const EMPTY = {
  name: "",
  email: "",
  topic: "",
  message: "",

  // Never shown. Only a bot fills it in.
  website: "",
};


export default function ContactUs({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        Contact us
      </button>

      {/* Closed means unmounted, so it reopens empty. */}
      {open && <ContactForm onClose={() => setOpen(false)} />}
    </>
  );
}


function ContactForm({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const set =
    (key: keyof typeof EMPTY) =>
    (
      event: React.ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >
    ) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

  const ready =
    form.name.trim() && form.email.trim() && form.topic && form.message.trim();

  async function submit() {
    if (!ready || busy) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || "That didn't send. Please try again.");
      }

      setSent(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "That didn't send. Please try again."
      );
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Dialog
        open
        title="Thanks, we've got it"
        onClose={onClose}
        footer={
          <DialogButton type="button" variant="primary" onClick={onClose}>
            Done
          </DialogButton>
        }
      >
        <p className="text-[13.5px] leading-relaxed text-[var(--text-muted)]">
          We&apos;ll reply to{" "}
          <span className="text-[var(--text)]">{form.email}</span>, usually
          within one working day.
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      wide
      title="Contact us"
      description="Questions, help with your account, partnerships or hackathons. We'll get back to you within one working day."
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <DialogButton type="button" onClick={onClose} disabled={busy}>
            Cancel
          </DialogButton>

          <DialogButton
            type="submit"
            form="contact-form"
            variant="primary"
            disabled={busy || !ready}
          >
            {busy ? "Sending…" : "Send"}
          </DialogButton>
        </>
      }
    >
      <form
        id="contact-form"
        onSubmit={(event) => {
          event.preventDefault();

          void submit();
        }}
        className="grid gap-3 sm:grid-cols-2"
      >
        <Field label="Name" required>
          <input
            className={FIELD}
            value={form.name}
            onChange={set("name")}
            autoComplete="name"
            maxLength={100}
            disabled={busy}
            required
          />
        </Field>

        <Field label="Email" required>
          <input
            className={FIELD}
            type="email"
            value={form.email}
            onChange={set("email")}
            autoComplete="email"
            maxLength={200}
            disabled={busy}
            required
          />
        </Field>

        <Field label="What's it about?" required wide>
          <select
            className={FIELD}
            value={form.topic}
            onChange={set("topic")}
            disabled={busy}
            required
          >
            <option value="" disabled>
              Choose…
            </option>

            {TOPICS.map((topic) => (
              <option key={topic} value={topic}>
                {topic}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Message" required wide>
          <textarea
            className={`${FIELD} resize-none leading-[1.5]`}
            rows={5}
            value={form.message}
            onChange={set("message")}
            maxLength={3000}
            disabled={busy}
            required
          />
        </Field>

        {/* Off-screen and skipped by keyboard and
            screen readers; only a bot fills it in. */}
        <input
          type="text"
          name="website"
          value={form.website}
          onChange={set("website")}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="absolute -left-[9999px] h-px w-px opacity-0"
        />

        {error && (
          <p className="text-[12.5px] leading-relaxed text-red-300 sm:col-span-2">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}


function Field({
  label,
  required = false,
  wide = false,
  children,
}: {
  label: string;
  required?: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
      <span className="mb-1.5 block text-[11px] tracking-[0.06em] text-[var(--text-faint)] uppercase">
        {label}
        {required && <span className="text-[var(--text-muted)]"> *</span>}
      </span>

      {children}
    </label>
  );
}
