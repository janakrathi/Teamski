import type { SupabaseClient } from "@supabase/supabase-js";

import {
  summarise,
  type Activity,
  type InviteRow,
  type Membership,
  type ProjectRow,
  type UserRow,
} from "./metrics.ts";


// ==========================================
// FETCHING WHAT THE ADMIN PAGE COUNTS
// ==========================================
//
// Needs the service role: it reads across every
// account. Only the admin page calls it.
//

export const WINDOW_DAYS = 90;


// Supabase returns at most 1000 rows a request.

async function all<T>(
  query: (from: number, to: number) => PromiseLike<{
    data: unknown[] | null;
    error: { message: string } | null;
  }>,
  cap = 50_000
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; from < cap; from += 1000) {
    const { data, error } = await query(from, from + 999);

    // A table from a migration that was never run
    // simply has nothing to count.

    if (error || !data) {
      break;
    }

    rows.push(...(data as T[]));

    if (data.length < 1000) {
      break;
    }
  }

  return rows;
}


export async function load(db: SupabaseClient) {
  const since = new Date(
    Date.now() - WINDOW_DAYS * 86_400_000
  ).toISOString();

  const users: UserRow[] = [];

  for (let page = 1; page < 100; page++) {
    const { data, error } = await db.auth.admin.listUsers({
      page,
      perPage: 1000,
    });

    if (error || !data) {
      break;
    }

    users.push(
      ...data.users.map((user) => ({
        id: user.id,
        email: user.email ?? null,
        name:
          (user.user_metadata?.full_name as string | undefined) ??
          (user.user_metadata?.name as string | undefined) ??
          null,
        createdAt: user.created_at,
      }))
    );

    if (data.users.length < 1000) {
      break;
    }
  }

  const [
    profiles,
    memberships,
    projects,
    messages,
    dms,
    runs,
    invites,
    subscriptions,
    connections,
    apps,
  ] = await Promise.all([
    all<{ id: string; display_name: string | null }>((a, b) =>
      db.from("profiles").select("id, display_name").range(a, b)
    ),
    all<{ project_id: string; user_id: string; role: string }>((a, b) =>
      db.from("project_members").select("project_id, user_id, role").range(a, b)
    ),
    all<{ id: string; name: string; created_at: string }>((a, b) =>
      db.from("projects").select("id, name, created_at").range(a, b)
    ),
    all<{ user_id: string | null; project_id: string; role: string; created_at: string }>(
      (a, b) =>
        db
          .from("messages")
          .select("user_id, project_id, role, created_at")
          .gte("created_at", since)
          .range(a, b)
    ),
    all<{ user_id: string; created_at: string }>((a, b) =>
      db
        .from("dm_messages")
        .select("user_id, created_at")
        .gte("created_at", since)
        .range(a, b)
    ),
    all<{ started_by: string | null; project_id: string; created_at: string }>(
      (a, b) =>
        db
          .from("agent_runs")
          .select("started_by, project_id, created_at")
          .gte("created_at", since)
          .range(a, b)
    ),
    all<{ created_at: string; accepted_at: string | null }>((a, b) =>
      db.from("project_invites").select("created_at, accepted_at").range(a, b)
    ),
    all<{ plan: string; current_period_end: string | null }>((a, b) =>
      db.from("subscriptions").select("plan, current_period_end").range(a, b)
    ),
    all<{ provider: string }>((a, b) =>
      db.from("connections").select("provider").range(a, b)
    ),
    all<{ status: string; enabled: boolean }>((a, b) =>
      db.from("mcp_servers").select("status, enabled").range(a, b)
    ),
  ]);

  // Coming-back nudges, kept apart so a database without
  // the winback_sent_at column just returns nothing
  // rather than emptying the profiles read above.

  const nudges = await all<{
    id: string;
    winback_sent_at: string;
  }>((a, b) =>
    db
      .from("profiles")
      .select("id, winback_sent_at")
      .not("winback_sent_at", "is", null)
      .range(a, b)
  );

  // The name people chose in Teamski wins over the
  // one their sign-in provider sent.

  const chosen = new Map(
    profiles.map((profile) => [profile.id, profile.display_name])
  );

  for (const user of users) {
    user.name = chosen.get(user.id) || user.name;
  }

  const activity: Activity[] = [
    ...messages.map((row) => ({
      userId: row.user_id,
      projectId: row.project_id,
      at: row.created_at,
      kind:
        row.role === "assistant"
          ? ("agent-reply" as const)
          : ("message" as const),
    })),
    ...dms.map((row) => ({
      userId: row.user_id,
      projectId: null,
      at: row.created_at,
      kind: "dm" as const,
    })),
    ...runs.map((row) => ({
      userId: row.started_by,
      projectId: row.project_id,
      at: row.created_at,
      kind: "agent-task" as const,
    })),
  ];

  const summary = summarise({
    users,
    memberships: memberships.map(
      (row): Membership => ({
        projectId: row.project_id,
        userId: row.user_id,
        role: row.role,
      })
    ),
    projects: projects.map(
      (row): ProjectRow => ({
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
      })
    ),
    activity,
    invites: invites.map(
      (row): InviteRow => ({
        createdAt: row.created_at,
        acceptedAt: row.accepted_at,
      })
    ),
    nudges: nudges.map((row) => ({
      userId: row.id,
      at: row.winback_sent_at,
    })),
  });

  // Paid plans that have not run out. Everyone
  // without a row is on Free.

  const paid = new Map<string, number>();

  for (const row of subscriptions) {
    const live =
      !row.current_period_end ||
      new Date(row.current_period_end) > new Date();

    if (live && row.plan !== "free") {
      paid.set(row.plan, (paid.get(row.plan) ?? 0) + 1);
    }
  }

  const count = (test: (provider: string) => boolean) =>
    connections.filter((row) => test(row.provider)).length;

  return {
    summary,
    plans: [...paid.entries()],
    connections: {
      google: count((provider) => provider === "google"),
      github: count((provider) => provider === "github"),
      modelKeys: count((provider) => provider.startsWith("model:")),
      apps: apps.filter((app) => app.status === "connected" && app.enabled)
        .length,
    },
  };
}


