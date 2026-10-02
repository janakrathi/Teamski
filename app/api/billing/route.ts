import { createClient } from "@/lib/supabase/server";

import { adminClient } from "@/lib/supabase/admin";

import {
  DAILY_MESSAGES,
  SELF_HOSTED,
  dailyLimit,
  OFFERS,
  PLAN_LABELS,
  builtinUsedToday,
  planOf,
  startOfDay,
  projectPlan,
} from "@/lib/plans";

export const dynamic = "force-dynamic";


// ==========================================
// YOUR PLAN
// ==========================================
//
// What you are on, when it renews, and what you
// could move to. The offers come from the server
// so the page and the checks can never disagree
// about what a plan includes.
//

export async function GET(request: Request) {
  const db = await createClient();

  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    return Response.json(
      { error: "You must be logged in." },
      { status: 401 }
    );
  }

  // Your own plan, for personal use outside any
  // project. Inside a project, the project's own plan
  // is what applies - see below.
  const personalPlan = await planOf(db, user.id);

  const projectId = new URL(
    request.url
  ).searchParams.get("projectId");

  let project: {
    plan: string;
    planLabel: string;
    owner: string | null;
    youOwn: boolean;
    renews: string | null;

    // On the free launch trial (Team, never charged), so
    // the UI says "free trial ends" not "renews".
    trial: boolean;
  } | null = null;

  if (projectId) {
    const { data: membership } = await db
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membership) {
      const admin = adminClient() ?? db;

      const info = await projectPlan(
        admin,
        projectId
      );

      const { data: ownerRow } = await admin
        .from("project_members")
        .select("user_id")
        .eq("project_id", projectId)
        .eq("role", "owner")
        .limit(1)
        .maybeSingle();

      const { data: ownerProfile } = ownerRow
        ? await admin
            .from("profiles")
            .select("display_name, email")
            .eq("id", ownerRow.user_id)
            .maybeSingle()
        : { data: null };

      project = {
        plan: info.plan,
        planLabel: PLAN_LABELS[info.plan],

        owner:
          ownerProfile?.display_name ||
          ownerProfile?.email ||
          null,

        youOwn: membership.role === "owner",
        renews: info.currentPeriodEnd,
        trial:
          info.plan === "team" &&
          info.provider === "promo",
      };
    }
  }

  // Inside a project, the plan that applies is the
  // project's - not your personal one. A leftover
  // personal subscription no longer makes every
  // project you open look paid.
  const plan = (project?.plan ??
    personalPlan) as keyof typeof DAILY_MESSAGES;

  const usedToday = await builtinUsedToday(
    db,
    user.id
  );

  const todayLimit = dailyLimit(plan);

  // When to renew comes from the project inside one,
  // and from your own subscription otherwise.
  const { data: personalSub } = await db
    .from("subscriptions")
    .select("current_period_end")
    .eq("user_id", user.id)
    .maybeSingle();

  const renews =
    plan === "free"
      ? null
      : project
        ? project.renews
        : (personalSub?.current_period_end ?? null);

  return Response.json({
    plan,
    planLabel: PLAN_LABELS[plan],

    renews,

    project,

    // No daily cap (a self-hosted copy without
    // DAILY_MESSAGE_LIMIT) means nothing to show.
    today: todayLimit === null ? null : {
      used: usedToday,
      limit: todayLimit,
      planLabel: SELF_HOSTED ? "Self-hosted" : PLAN_LABELS[plan],

      // The allowance is counted by UTC day.
      resetsAt: new Date(
        new Date(startOfDay()).getTime() + 86_400_000
      ).toISOString(),
    },

    selfHosted: SELF_HOSTED,

    offers: OFFERS.map((offer) => ({
      ...offer,
      label: PLAN_LABELS[offer.plan],
    })),
  });
}
