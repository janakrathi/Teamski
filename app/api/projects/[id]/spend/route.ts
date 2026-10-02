import { createClient } from "@/lib/supabase/server";

import { costOf, formatUsd } from "@/lib/ai/cost";

import { startOfMonth } from "@/lib/ai/spend";

import { adminClient } from "@/lib/supabase/admin";

import {
  PLAN_LABELS,
  allows,
  planFor,
  projectOwnerPlan,
} from "@/lib/plans";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};


// ==========================================
// WHERE THE MONEY WENT
// ==========================================
//
// A shared key means one person's card pays for
// other people's messages. That needs to be
// visible to the person paying, and honestly
// visible to everyone else - somebody spending a
// colleague's money should be able to see how
// much.
//
// The figures are estimates from a price list
// that goes stale, and every response says so.
// The provider's invoice is the truth; this is
// for noticing a problem before the invoice
// arrives.
//

export async function GET(
  _request: Request,
  context: RouteContext
) {
  const { id: projectId } = await context.params;

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

  const plan = await projectOwnerPlan(
    adminClient() ?? db,
    projectId
  );

  if (!allows(plan, "spend_report")) {
    return Response.json({
      people: [],
      locked: true,
      requiredPlan:
        PLAN_LABELS[planFor("spend_report")],
    });
  }

  const since = startOfMonth();

  const { data, error } = await db.rpc(
    "project_spend",
    {
      p_project_id: projectId,
      p_since: since,
    }
  );

  if (error) {
    if (
      error.code === "42883" ||
      error.code === "PGRST202" ||
      error.code === "42703"
    ) {
      return Response.json({
        rows: [],
        needsMigration: true,
      });
    }

    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }

  const rows = (data ?? []) as {
    user_id: string | null;
    model: string;
    paid_by: string;
    prompt_tokens: number;
    response_tokens: number;
    turns: number;
  }[];

  // Names, so a report about people reads like
  // one. Row level security already limits this
  // to a project the caller is in.

  const ids = [
    ...new Set(
      rows
        .map((row) => row.user_id)
        .filter(Boolean) as string[]
    ),
  ];

  const { data: profiles } =
    ids.length > 0
      ? await db
          .from("profiles")
          .select("id, display_name, email")
          .in("id", ids)
      : { data: [] };

  const nameOf = new Map(
    (profiles ?? []).map((profile) => [
      profile.id,
      profile.display_name || profile.email,
    ])
  );

  // Per person, and separately per whose key -
  // spending your own money and spending the
  // project's are different facts.

  const byPerson = new Map<
    string,
    {
      name: string;
      usd: number;
      tokens: number;
      turns: number;
      estimated: boolean;
      onProjectKey: number;
    }
  >();

  let projectTotal = 0;

  let anyUnpriced = false;

  for (const row of rows) {
    const key = row.user_id ?? "unknown";

    const cost = costOf(
      row.model,
      row.prompt_tokens,
      row.response_tokens
    );

    if (!cost.known && row.paid_by !== "local") {
      anyUnpriced = true;
    }

    const entry = byPerson.get(key) ?? {
      name:
        nameOf.get(key) ??
        (row.user_id
          ? "Someone"
          : "Background work"),

      usd: 0,
      tokens: 0,
      turns: 0,
      estimated: false,
      onProjectKey: 0,
    };

    entry.usd += cost.usd;

    entry.tokens +=
      row.prompt_tokens + row.response_tokens;

    entry.turns += Number(row.turns);

    if (!cost.known && row.paid_by !== "local") {
      entry.estimated = true;
    }

    if (row.paid_by === "project") {
      entry.onProjectKey += cost.usd;

      projectTotal += cost.usd;
    }

    byPerson.set(key, entry);
  }

  return Response.json({
    since,

    people: [...byPerson.values()]
      .sort((a, b) => b.usd - a.usd)
      .map((entry) => ({
        ...entry,
        usdLabel: formatUsd(entry.usd),

        onProjectKeyLabel: formatUsd(
          entry.onProjectKey
        ),
      })),

    projectTotal,
    projectTotalLabel: formatUsd(projectTotal),

    // Said plainly rather than implied: some of
    // these models have no price on file, so the
    // total is a floor.
    someUnpriced: anyUnpriced,
  });
}
