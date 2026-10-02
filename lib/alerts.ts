import { sendEmail } from "./email/send.ts";

import { escapeHtml } from "./email/templates.ts";


// ==========================================
// TELLING WHOEVER RUNS TEAMSKI SOMETHING BROKE
// ==========================================
//
// An email to ALERT_EMAILS (or, if unset, the
// ADMIN_EMAILS that can open /admin), through the
// same Resend account the invites use. Without an
// address or a Resend key nothing is sent, and
// nothing else breaks.
//
// A problem that keeps happening sends one email,
// then at most one every half hour for the same
// problem, saying how many more there were in
// between. A problem that clears can say so.
//
// Kept to plain fetch and relative imports, so the
// worker, which runs outside Next, uses the same
// file.
//

const COOLDOWN_MS = 30 * 60 * 1000;


// Keys and tokens can end up inside error
// messages - a provider echoing a bad key, a URL
// with a token in it. None of that goes in an
// email.

export function redact(text: string) {
  return text
    .replace(/\b(sk|rk|pk)-[A-Za-z0-9_-]{12,}/g, "[key]")
    .replace(/\bsk-ant-[A-Za-z0-9_-]{12,}/g, "[key]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, "[key]")
    .replace(/\bnvapi-[A-Za-z0-9_-]{12,}/g, "[key]")
    .replace(/\bre_[A-Za-z0-9_]{12,}/g, "[key]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "[key]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[token]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, "$1[token]")
    .replace(/([?&](key|token|access_token|api_key|secret)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(postgres(ql)?:\/\/[^:\s]+:)[^@\s]+@/gi, "$1[password]@");
}


export type Alert = {
  // What kind of problem, so repeats of it are
  // grouped: "ai-down", "worker-loop".
  key: string;

  title: string;

  detail?: string;

  // "resolved" is the follow-up when it clears.
  level?: "problem" | "resolved";
};

type Send = (alert: Alert & { repeats: number }) => Promise<void>;


// The rate limiting, apart from any email, so it
// can be tested.

export function createAlerter(options: {
  send: Send;
  now?: () => number;
  cooldownMs?: number;
}) {
  const now = options.now ?? Date.now;
  const cooldown = options.cooldownMs ?? COOLDOWN_MS;

  const seen = new Map<string, { lastSent: number; since: number; open: boolean }>();

  return async function raise(alert: Alert) {
    const entry = seen.get(alert.key);

    if (alert.level === "resolved") {
      // Only worth saying if a problem was reported.
      if (entry?.open) {
        seen.set(alert.key, { lastSent: now(), since: 0, open: false });

        await options.send({ ...alert, repeats: 0 });
      }

      return;
    }

    if (entry?.open && now() - entry.lastSent < cooldown) {
      entry.since += 1;

      return;
    }

    const repeats = entry?.open ? entry.since : 0;

    seen.set(alert.key, { lastSent: now(), since: 0, open: true });

    await options.send({ ...alert, repeats });
  };
}


function recipients() {
  return (process.env.ALERT_EMAILS || process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
}


async function email(alert: Alert & { repeats: number }, source: string) {
  const to = recipients();

  if (to.length === 0) {
    return;
  }

  const resolved = alert.level === "resolved";

  const subject = `${resolved ? "Resolved" : "Teamski alert"}: ${alert.title}`;

  const detail = redact(alert.detail ?? "").slice(0, 3000);

  const lines = [
    alert.title,
    "",
    detail,
    "",
    alert.repeats > 0
      ? `It happened ${alert.repeats} more ${alert.repeats === 1 ? "time" : "times"} since the last email.`
      : "",
    `From: ${source} · ${new Date().toISOString()}`,
    "",
    resolved
      ? ""
      : "Look on the server with: pm2 logs web --lines 100 and pm2 logs worker --lines 100",
  ].filter((line, index, all) => !(line === "" && all[index - 1] === ""));

  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#1a1a18">
<p style="font-size:16px;font-weight:600;margin:0 0 12px">${escapeHtml(alert.title)}</p>
${detail ? `<pre style="white-space:pre-wrap;background:#f6f5f2;border:1px solid #e6e3dd;border-radius:8px;padding:10px;font-size:12.5px">${escapeHtml(detail)}</pre>` : ""}
${alert.repeats > 0 ? `<p>It happened ${alert.repeats} more ${alert.repeats === 1 ? "time" : "times"} since the last email.</p>` : ""}
<p style="color:#8a8782;font-size:12px">From ${escapeHtml(source)} · ${new Date().toISOString()}</p>
${resolved ? "" : `<p style="color:#8a8782;font-size:12px">On the server: <code>pm2 logs web --lines 100</code> and <code>pm2 logs worker --lines 100</code></p>`}
</div>`;

  for (const address of to) {
    await sendEmail({ to: address, subject, html, text: lines.join("\n") }).catch(
      () => undefined
    );
  }
}


// One per process - the web app and the worker
// each keep their own count.

const alerters = new Map<string, ReturnType<typeof createAlerter>>();


export async function raiseAlert(source: "web" | "worker", alert: Alert) {
  let raise = alerters.get(source);

  if (!raise) {
    raise = createAlerter({ send: (item) => email(item, source) });

    alerters.set(source, raise);
  }

  try {
    await raise(alert);
  } catch (error) {
    // An alert that cannot be sent must never be
    // the thing that breaks a request.
    console.error("Could not send an alert:", error);
  }
}


export function describeError(error: unknown) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${
      error.stack ? `\n\n${error.stack.split("\n").slice(1, 8).join("\n")}` : ""
    }`;
  }

  return String(error);
}
