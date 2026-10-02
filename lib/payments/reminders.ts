import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_CURRENCY,
  INCLUDED_MEMBERS,
  asCurrency,
  formatMoney,
  teamMonthlyPriceINR,
} from "../plans.ts";

import { sendEmail } from "../email/send.ts";

import { renewalReminderEmail } from "../email/templates.ts";


// ==========================================
// RENEWAL REMINDERS
// ==========================================
//
// Emails a project's owner once, a few days before
// the Team plan lapses, so a renewal is a choice and
// not a surprise lapse. One reminder per period:
// reminder_sent_at marks it, and is cleared when a
// payment starts a fresh period.
//
// Runs from the worker on a slow timer. The service
// role reads owner emails and project names, which
// browsers may not.
//

const DAY = 24 * 60 * 60 * 1000;


export async function sendDueRenewalReminders(
  admin: SupabaseClient
) {
  const now = Date.now();

  const site =
    process.env.NEXT_PUBLIC_SITE_URL ??
    "https://teamski.in";

  // Team projects lapsing within three days (or that
  // lapsed in the last day), so a just-missed one
  // still gets its nudge.
  const { data, error } = await admin
    .from("project_subscriptions")
    .select(
      "project_id, owner_id, current_period_end, reminder_sent_at, shown_currency, included_members, extra_members, provider"
    )
    .eq("plan", "team")
    .not("current_period_end", "is", null)
    .lte(
      "current_period_end",
      new Date(now + 3 * DAY).toISOString()
    )
    .gte(
      "current_period_end",
      new Date(now - 1 * DAY).toISOString()
    );

  if (error || !data) {
    return;
  }

  for (const row of data) {
    const periodEnd = new Date(
      row.current_period_end as string
    ).getTime();

    // One reminder per period: skip if the last one
    // already falls inside this period's window.
    if (
      row.reminder_sent_at &&
      new Date(row.reminder_sent_at).getTime() >
        periodEnd - 5 * DAY
    ) {
      continue;
    }

    const { data: owner } = await admin
      .from("profiles")
      .select("email")
      .eq("id", row.owner_id)
      .maybeSingle();

    if (!owner?.email) {
      continue;
    }

    const { data: project } = await admin
      .from("projects")
      .select("name")
      .eq("id", row.project_id)
      .maybeSingle();

    const currency =
      asCurrency(
        (row.shown_currency as string) ??
          DEFAULT_CURRENCY
      ) ?? DEFAULT_CURRENCY;

    const included =
      (row.included_members as number) ??
      INCLUDED_MEMBERS;

    const members =
      included + ((row.extra_members as number) ?? 0);

    const email = renewalReminderEmail({
      to: owner.email as string,
      projectName:
        (project?.name as string) ?? "your project",
      site,
      price: formatMoney(
        "INR",
        teamMonthlyPriceINR(members, currency)
      ),
      includedMembers: included,
      renewsOn: new Date(periodEnd).toLocaleDateString(
        "en-GB",
        {
          day: "numeric",
          month: "short",
          year: "numeric",
        }
      ),
      daysLeft: Math.ceil((periodEnd - now) / DAY),

      // A promo trial ending reads as "upgrade", a paid
      // plan as "renew".
      trial: (row.provider as string) === "promo",
    });

    const result = await sendEmail(email);

    if (result.sent) {
      await admin
        .from("project_subscriptions")
        .update({
          reminder_sent_at: new Date().toISOString(),
        })
        .eq("project_id", row.project_id);
    }
  }
}
