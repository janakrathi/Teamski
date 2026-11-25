// ==========================================
// EMAIL EVERYONE ABOUT THE DESKTOP APP
// ==========================================
//
//   npm run launch-email                          dry run: who would get it, and a preview
//   npm run launch-email -- --test you@example.com one copy to you
//   npm run launch-email -- --send                 send the next batch (95 by default)
//   npm run launch-email -- --send --limit 40
//   add --include-winback to also send to people who got
//   the win-back email
//
// Who gets it: every account with a confirmed email.
// The win-back email promised "we won't email again", so
// people who got it are skipped unless --include-winback
// is passed - a choice made on purpose, not by default.
//
// Each person gets it once. Who has been sent is kept in
// data/desktop-launch-sent.json, so the script can be run
// again on later days: Resend's free plan sends about 100
// a day, and the script stops on its own when Resend says
// the day is used up.
//

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { sendEmail } from "../lib/email/send.ts";
import { desktopLaunchEmail } from "../lib/email/templates.ts";

const LOG = new URL("../data/desktop-launch-sent.json", import.meta.url);
const PREVIEW = new URL("../data/desktop-launch-preview.html", import.meta.url);

// ------------------------------------------
// ARGUMENTS
// ------------------------------------------

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};

const mode = flag("--send") ? "send" : value("--test") ? "test" : "dry-run";
const limit = Math.max(1, Number(value("--limit") ?? 95));
const includeWinback = flag("--include-winback");

const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://teamski.in";

// ------------------------------------------
// ONE TEST COPY
// ------------------------------------------

if (mode === "test") {
  const to = value("--test")!;
  const result = await sendEmail(desktopLaunchEmail({ to, site, name: null }));
  console.log(result.sent ? `Sent a test copy to ${to}. Check the inbox, and spam.` : `Not sent (${result.reason})${result.detail ? `: ${result.detail}` : ""}`);
  process.exit(result.sent ? 0 : 1);
}

// ------------------------------------------
// WHO
// ------------------------------------------

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.log("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false } });

type Person = { id: string; email: string; name: string | null };

const people: Person[] = [];
let unconfirmed = 0;

for (let page = 1; page < 100; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });

  if (error || !data) {
    console.log(`Couldn't list accounts: ${error?.message ?? "no data"}`);
    process.exit(1);
  }

  for (const user of data.users) {
    const email = user.email?.trim();
    if (!email) continue;

    // Only addresses someone has shown they own.
    if (!user.email_confirmed_at) {
      unconfirmed++;
      continue;
    }

    const bannedUntil = (user as { banned_until?: string }).banned_until;
    if (bannedUntil && new Date(bannedUntil).getTime() > Date.now()) continue;

    people.push({
      id: user.id,
      email,
      name: (user.user_metadata?.full_name as string | undefined) ?? (user.user_metadata?.name as string | undefined) ?? null,
    });
  }

  if (data.users.length < 1000) break;
}

// Names they chose beat what a sign-in provider sent, and
// the win-back promise is kept.
const promised = new Set<string>();

for (let i = 0; i < people.length; i += 500) {
  const ids = people.slice(i, i + 500).map((person) => person.id);
  const { data } = await admin.from("profiles").select("id, display_name, winback_sent_at").in("id", ids);

  for (const row of data ?? []) {
    if (row.winback_sent_at) promised.add(row.id as string);
    const person = people.find((entry) => entry.id === row.id);
    if (person && row.display_name) person.name = row.display_name as string;
  }
}

const sent = new Set<string>(existsSync(LOG) ? (JSON.parse(readFileSync(LOG, "utf8")) as string[]) : []);

const due = people.filter((person) => (includeWinback || !promised.has(person.id)) && !sent.has(person.id));

console.log(`Accounts with a confirmed email: ${people.length}`);
console.log(
  includeWinback
    ? `  including ${people.filter((p) => promised.has(p.id)).length} who got the win-back email (--include-winback)`
    : `  skipped, got the win-back email ("we won't email again"): ${people.filter((p) => promised.has(p.id)).length} - add --include-winback to send to them too`
);
console.log(`  already sent this email: ${people.filter((p) => sent.has(p.id)).length}`);
console.log(`  unconfirmed addresses (not counted above): ${unconfirmed}`);
console.log(`Still to send: ${due.length}`);

if (mode === "dry-run") {
  mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
  writeFileSync(PREVIEW, desktopLaunchEmail({ to: "preview@example.com", site, name: "Riya" }).html);
  console.log(`\nPreview: data/desktop-launch-preview.html`);
  console.log(`Nothing was sent. To send the next ${Math.min(limit, due.length)}: npm run launch-email -- --send${includeWinback ? " --include-winback" : ""}`);
  process.exit(0);
}

// ------------------------------------------
// SEND
// ------------------------------------------

if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
  console.log("Set RESEND_API_KEY and EMAIL_FROM in .env.local first.");
  process.exit(1);
}

mkdirSync(new URL("../data/", import.meta.url), { recursive: true });

let count = 0;
let failed = 0;

for (const person of due.slice(0, limit)) {
  const result = await sendEmail(desktopLaunchEmail({ to: person.email, site, name: person.name }));

  if (result.sent) {
    sent.add(person.id);
    count++;
    writeFileSync(LOG, JSON.stringify([...sent]));
  } else {
    failed++;
    const detail = `${result.reason}${result.detail ? `: ${result.detail}` : ""}`;

    // Resend's daily or per-second limit: stop, keep the
    // log, run again later.
    if (/429|rate|quota|limit/i.test(detail)) {
      console.log(`Resend says the limit is reached (${detail}). Stopping - run again later to carry on.`);
      break;
    }

    console.log(`Couldn't send to one address (${detail}).`);
  }

  // Under Resend's two-a-second limit.
  await new Promise((resolve) => setTimeout(resolve, 600));
}

console.log(`\nSent ${count}. Failed ${failed}. Left to send: ${due.length - count}.`);
