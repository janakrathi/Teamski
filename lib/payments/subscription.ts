import type { SupabaseClient } from "@supabase/supabase-js";

import {
  INCLUDED_MEMBERS,
  TRIAL_DAYS,
} from "@/lib/plans";


// ==========================================
// TURNING A PAYMENT INTO A TEAM PLAN
// ==========================================
//
// One place writes the plan, called by both the
// browser's confirmation and the webhook - so it does
// not matter which arrives first, or if both do. It
// is idempotent: an order already applied is a no-op,
// so a plan is never extended twice for one payment.
//
// Always the service role: the row is billing state,
// which browsers may read but never write.
//

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;


// ==========================================
// THE LAUNCH FREE TRIAL
// ==========================================
//
// A new project starts on Team, free, for TRIAL_DAYS,
// then lapses to Free on its own. Written as an ordinary
// subscription row with provider "promo", so the plan,
// the reminder email and the expiry all work exactly as
// they do for a paid project - it just was not paid for.
//
// Never overwrites an existing row (ignoreDuplicates), so
// a project that already has a subscription - a real
// payment, or a trial already granted - is left alone.
// Best effort: a project with no trial row is simply on
// Free, which is not an error worth failing creation over.
//

export async function startTrial(
  admin: SupabaseClient,
  input: { projectId: string; ownerId: string }
): Promise<void> {
  const end = new Date(
    Date.now() + TRIAL_DAYS * DAY_MS
  ).toISOString();

  const { error } = await admin
    .from("project_subscriptions")
    .upsert(
      {
        project_id: input.projectId,
        owner_id: input.ownerId,
        plan: "team",
        current_period_end: end,
        provider: "promo",
        included_members: INCLUDED_MEMBERS,
        extra_members: 0,
        reminder_sent_at: null,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "project_id",
        ignoreDuplicates: true,
      }
    );

  if (error) {
    // The table may not exist yet (migrations 0029/0030
    // not run) - the project still works, on Free.
    console.error(
      "Could not start the free trial:",
      error.message
    );
  }
}


export async function activateTeam(
  admin: SupabaseClient,
  input: {
    projectId: string;
    ownerId: string;
    orderId: string;

    // What the owner saw and how many seats, kept so
    // the renewal reminder can quote the right price.
    currency?: string;
    members?: number;
  }
): Promise<
  | { ok: true; alreadyApplied: boolean }
  | { ok: false; error: string }
> {
  const { data: existing } = await admin
    .from("project_subscriptions")
    .select(
      "current_period_end, provider_subscription_id"
    )
    .eq("project_id", input.projectId)
    .maybeSingle();

  // This exact order already turned this project into
  // Team - nothing more to do.
  if (
    existing?.provider_subscription_id ===
    input.orderId
  ) {
    return { ok: true, alreadyApplied: true };
  }

  // A month from now, or from the current end if the
  // plan has not lapsed yet - so renewing early adds
  // a month rather than losing the remaining days.
  const now = Date.now();

  const from =
    existing?.current_period_end &&
    new Date(existing.current_period_end).getTime() >
      now
      ? new Date(
          existing.current_period_end
        ).getTime()
      : now;

  const currentPeriodEnd = new Date(
    from + MONTH_MS
  ).toISOString();

  const { error } = await admin
    .from("project_subscriptions")
    .upsert(
      {
        project_id: input.projectId,
        owner_id: input.ownerId,
        plan: "team",
        current_period_end: currentPeriodEnd,
        provider: "razorpay",
        provider_subscription_id: input.orderId,
        included_members: INCLUDED_MEMBERS,
        extra_members: 0,
        shown_currency: input.currency ?? null,
        // A fresh reminder window for the new period.
        reminder_sent_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id" }
    );

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, alreadyApplied: false };
}
