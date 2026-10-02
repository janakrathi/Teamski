import type { SupabaseClient } from "@supabase/supabase-js";

import { sendEmail } from "./send.ts";

import { winbackEmail } from "./templates.ts";


// ==========================================
// COMING-BACK NUDGE
// ==========================================
//
// Emails someone once, a couple of days after they
// signed up, if they never really came back. The aim
// is the person who made an account, glanced around,
// and closed the tab - a reminder of what Teamski is
// for, sent while they might still remember signing up.
//
// "Came back" is read generously, so nobody engaged
// gets nagged. Anyone who signed in again on a later
// day, or sent a single message, DM, or agent task, is
// left alone. Only the ones who did none of that hear
// from us.
//
// Runs from the worker on a slow timer. Signup time and
// the last sign-in both live on auth.users, which the
// service role reads; profiles.winback_sent_at marks
// who has already had their one nudge.
//

const DAY = 24 * 60 * 60 * 1000;

// Old enough that "didn't come back" means something.
// Anyone who signed up at least this long ago and never
// returned is a candidate - however long ago that was,
// so the whole dormant back-catalogue is in scope, not
// just the last few days.

const MIN_AGE_MS = 2 * DAY;

// But never all at once. Each pass sends at most this
// many, newest signups first, then stops. The rest wait
// for the next pass. A cold batch this small keeps the
// domain out of spam folders and inside Resend's limits,
// and the backlog drains ten at a time until only the
// day-to-day trickle of new signups is left.

const BATCH_LIMIT = 10;

// How long with no message, DM, or task counts as
// "away". Matches the intent: nudge people who have been
// gone two days or more, and never a current user.

const AWAY_DAYS = 2;


type Candidate = {
  id: string;
  email: string;
  name: string | null;
  createdAt: number;
};


export async function sendDueWinbackEmails(
  admin: SupabaseClient
) {
  const now = Date.now();

  const site =
    process.env.NEXT_PUBLIC_SITE_URL ??
    "https://teamski.in";

  // ----------------------------------------
  // WHO SIGNED UP LONG ENOUGH AGO
  // ----------------------------------------
  //
  // Everyone whose account is at least two days old.
  // Whether they are still around is decided below, by
  // recent activity.

  const candidates: Candidate[] = [];

  for (let page = 1; page < 100; page++) {
    const { data, error } =
      await admin.auth.admin.listUsers({
        page,
        perPage: 1000,
      });

    if (error || !data) {
      break;
    }

    for (const user of data.users) {
      const email = user.email?.trim();

      if (!email) {
        continue;
      }

      const createdAt = user.created_at
        ? new Date(user.created_at).getTime()
        : 0;

      if (!createdAt) {
        continue;
      }

      // Too new to have missed anything yet.
      if (now - createdAt < MIN_AGE_MS) {
        continue;
      }

      candidates.push({
        id: user.id,
        email,
        name:
          (user.user_metadata?.full_name as
            | string
            | undefined) ??
          (user.user_metadata?.name as
            | string
            | undefined) ??
          null,
        createdAt,
      });
    }

    if (data.users.length < 1000) {
      break;
    }
  }

  if (candidates.length === 0) {
    return;
  }

  // Newest signups first: they remember signing up, so
  // they are likeliest to come back, and the backlog
  // drains recent-to-old.
  candidates.sort((a, b) => b.createdAt - a.createdAt);

  const ids = candidates.map((row) => row.id);

  // ----------------------------------------
  // WHO HAS ALREADY BEEN NUDGED
  // ----------------------------------------
  //
  // One nudge per person, ever. The mark also carries
  // the chosen display name, which beats the one their
  // sign-in provider sent.

  const nudged = new Set<string>();
  const displayName = new Map<string, string | null>();

  {
    const { data } = await admin
      .from("profiles")
      .select("id, display_name, winback_sent_at")
      .in("id", ids);

    for (const row of data ?? []) {
      if (row.winback_sent_at) {
        nudged.add(row.id as string);
      }

      displayName.set(
        row.id as string,
        (row.display_name as string | null) ?? null
      );
    }
  }

  // ----------------------------------------
  // WHO IS AWAY
  // ----------------------------------------
  //
  // "Away" means no message, DM, or agent task in the
  // last couple of days. Someone who did something more
  // recently is a current user and is left alone;
  // everyone else old enough gets their one nudge. This
  // one rule does both jobs: right now it reaches the
  // whole dormant base, and from here on it only ever
  // emails a person once they have been away this long.
  // Three cheap lookups over just these people.

  const activeSince = new Date(
    now - AWAY_DAYS * DAY
  ).toISOString();

  const active = new Set<string>();

  const marks = await Promise.all([
    admin
      .from("messages")
      .select("user_id")
      .eq("role", "user")
      .gte("created_at", activeSince)
      .in("user_id", ids),
    admin
      .from("dm_messages")
      .select("user_id")
      .gte("created_at", activeSince)
      .in("user_id", ids),
    admin
      .from("agent_runs")
      .select("started_by")
      .gte("created_at", activeSince)
      .in("started_by", ids),
  ]);

  for (const row of marks[0].data ?? []) {
    if (row.user_id) active.add(row.user_id as string);
  }

  for (const row of marks[1].data ?? []) {
    if (row.user_id) active.add(row.user_id as string);
  }

  for (const row of marks[2].data ?? []) {
    if (row.started_by)
      active.add(row.started_by as string);
  }

  // Old enough, away long enough, not already nudged.
  const eligible = candidates.filter(
    (person) =>
      !nudged.has(person.id) && !active.has(person.id)
  );

  // ----------------------------------------
  // SEND
  // ----------------------------------------

  let sent = 0;
  let failed = 0;
  let lastFailure = "";

  for (const person of eligible) {
    // Ten per pass, then stop and leave the rest for
    // next time.
    if (sent >= BATCH_LIMIT) {
      break;
    }

    const email = winbackEmail({
      to: person.email,
      site,
      name:
        displayName.get(person.id) ?? person.name,
    });

    const result = await sendEmail(email);

    // Mark it the moment it is sent, so a second pass -
    // or a second worker - never sends it twice.
    if (result.sent) {
      sent += 1;

      await admin
        .from("profiles")
        .update({
          winback_sent_at: new Date().toISOString(),
        })
        .eq("id", person.id);
    } else {
      failed += 1;

      lastFailure = result.detail
        ? `${result.reason}: ${result.detail}`
        : result.reason;
    }
  }

  // One line per pass so the backlog is visible in the
  // worker log, and a rejected send says why instead of
  // vanishing (an unverified Resend domain, say, which
  // only lets you email your own address).
  const left = Math.max(0, eligible.length - sent);

  console.log(
    `  winback: ${candidates.length} due, ${eligible.length} eligible, sent ${sent}, ${left} left` +
      (failed
        ? ` — ${failed} failed (${lastFailure})`
        : "")
  );
}
