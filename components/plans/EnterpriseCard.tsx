"use client";

import { useState } from "react";

import { Dialog, DialogButton } from "@/components/ui/Dialog";

import { TEAM_SIZES } from "@/lib/enterprise";

import { trackMeta } from "@/lib/analytics/meta";


// ==========================================
// ENTERPRISE
// ==========================================
//
// The third plan: no price, a conversation. "Contact
// sales" opens a short form; what it sends lands in the
// team's Google Sheet and inbox (app/api/enterprise).
//

const FEATURES = [
  "Everything in Team",
  "Higher usage limits",
  "Custom integrations and workflows",
  "Dedicated support",
  "Advanced security and permissions",
  "A plan shaped around how your team works",
];

const FIELD =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2 text-[13.5px] text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--border-strong)] disabled:opacity-60";

const EMPTY = {
  name: "",
  email: "",
  company: "",
  role: "",
  teamSize: "",
  phone: "",
  country: "",
  needs: "",

  // Never shown. Only a bot fills it in.
  website: "",
};


export default function EnterpriseCard() {
  const [open, setOpen] = useState(false);

  return (
    <div
      style={{ "--i": 2 } as React.CSSProperties}
      className="t-reveal-card lp-card flex flex-col rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] p-6"
    >
      <h3 className="text-[16px] font-semibold">Enterprise</h3>

      <p className="mt-1 text-[13px] text-[var(--text-muted)]">
        For larger teams with custom needs and advanced control.
      </p>

      <p className="mt-5 text-[32px] font-semibold tracking-[-0.02em]">
        Talk to us
      </p>

      <ul className="mt-5 flex-1 space-y-2">
        {FEATURES.map((feature) => (
          <li
            key={feature}
            className="flex gap-2 text-[13px] leading-[1.5] text-[var(--text-muted)]"
          >
            <span
              aria-hidden="true"
              className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--text-faint)]"
            />

            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-6 rounded-lg bg-[var(--text)] px-4 py-2 text-center text-[13.5px] font-medium text-[var(--bg)] transition hover:opacity-90"
      >
        Contact sales
      </button>

      {/* Closed means unmounted, so it reopens empty. */}
      {open && <ContactForm onClose={() => setOpen(false)} />}
    </div>
  );
}


function ContactForm({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState(EMPTY);

  // One id for this enquiry, sent with the pixel's Lead
  // and the server's, so Meta counts it once.
  const [eventId] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `lead-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
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
    form.name.trim() &&
    form.email.trim() &&
    form.company.trim() &&
    form.teamSize &&
    form.needs.trim();

  async function submit() {
    if (!ready || busy) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/enterprise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, eventId }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || "That didn't send. Please try again.");
      }

      // The conversion Meta ads optimise enterprise
      // campaigns for.
      trackMeta(
        "Lead",
        { content_name: "Enterprise", team_size: form.teamSize },
        eventId
      );

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
        title="Thanks — we've got it"
        onClose={onClose}
        footer={
          <DialogButton type="button" variant="primary" onClick={onClose}>
            Done
          </DialogButton>
        }
      >
        <p className="text-[13.5px] leading-relaxed text-[var(--text-muted)]">
          Someone from the Teamski team will reply to{" "}
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
      title="Contact sales"
      description="Tell us about your team and what you need. We'll get back to you within one working day."
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <DialogButton type="button" onClick={onClose} disabled={busy}>
            Cancel
          </DialogButton>

          <DialogButton
            type="submit"
            form="enterprise-form"
            variant="primary"
            disabled={busy || !ready}
          >
            {busy ? "Sending…" : "Send"}
          </DialogButton>
        </>
      }
    >
      <form
        id="enterprise-form"
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

        <Field label="Work email" required>
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

        <Field label="Company" required>
          <input
            className={FIELD}
            value={form.company}
            onChange={set("company")}
            autoComplete="organization"
            maxLength={150}
            disabled={busy}
            required
          />
        </Field>

        <Field label="Your role">
          <input
            className={FIELD}
            value={form.role}
            onChange={set("role")}
            autoComplete="organization-title"
            placeholder="e.g. Head of Engineering"
            maxLength={100}
            disabled={busy}
          />
        </Field>

        <Field label="Team size" required>
          <select
            className={FIELD}
            value={form.teamSize}
            onChange={set("teamSize")}
            disabled={busy}
            required
          >
            <option value="" disabled>
              Choose…
            </option>

            {TEAM_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} people
              </option>
            ))}
          </select>
        </Field>

        <Field label="Phone">
          <input
            className={FIELD}
            type="tel"
            value={form.phone}
            onChange={set("phone")}
            autoComplete="tel"
            maxLength={40}
            disabled={busy}
          />
        </Field>

        <Field label="Country" wide>
          <input
            className={FIELD}
            value={form.country}
            onChange={set("country")}
            autoComplete="country-name"
            maxLength={80}
            disabled={busy}
          />
        </Field>

        <Field label="What do you need?" required wide>
          <textarea
            className={`${FIELD} resize-none leading-[1.5]`}
            rows={4}
            value={form.needs}
            onChange={set("needs")}
            placeholder="How your team would use Teamski, the tools you need connected, security or compliance requirements…"
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
