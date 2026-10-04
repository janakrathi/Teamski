import { createClient } from "@/lib/supabase/server";

import { adminClient } from "@/lib/supabase/admin";

import { can, roleInProject } from "@/lib/plans";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


// ==========================================
// THE AUDIT LOG, READ
// ==========================================
//
// The latest changes in a project, for its owner and
// admins. Row-level security keeps the rows to them as
// well (migration 0034); the actors' names are filled in
// with the service role, since a removed member's
// profile is no longer readable to the team.
//

export async function GET(request: Request, context: RouteContext) {
  const { id: projectId } = await context.params;

  if (!uuidRegex.test(projectId)) {
    return Response.json({ error: "Invalid project ID." }, { status: 400 });
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "You must be logged in." }, { status: 401 });
  }

  const role = await roleInProject(supabase, projectId, user.id);

  if (!can(role, "manage_members")) {
    return Response.json(
      { error: "Only an owner or admin can see the activity log." },
      { status: 403 }
    );
  }

  const before = new URL(request.url).searchParams.get("before");

  let query = supabase
    .from("audit_log")
    .select("id, actor_id, action, target, details, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (before && !Number.isNaN(Date.parse(before))) {
    query = query.lt("created_at", before);
  }

  const { data, error } = await query;

  if (error) {
    const missing = error.code === "42P01" || error.code === "PGRST205";

    return Response.json(
      {
        error: missing
          ? "Run supabase/migrations/0034_viewers_private_channels.sql to start the activity log."
          : error.message,
        needsMigration: missing,
      },
      { status: missing ? 400 : 500 }
    );
  }

  const rows = (data ?? []) as {
    id: number;
    actor_id: string | null;
    action: string;
    target: string | null;
    details: Record<string, unknown> | null;
    created_at: string;
  }[];

  const actorIds = [...new Set(rows.map((row) => row.actor_id).filter(Boolean))] as string[];

  const names = new Map<string, string>();

  if (actorIds.length > 0) {
    const { data: profiles } = await (adminClient() ?? supabase)
      .from("profiles")
      .select("id, email, display_name")
      .in("id", actorIds);

    for (const profile of (profiles ?? []) as {
      id: string;
      email: string | null;
      display_name: string | null;
    }[]) {
      names.set(profile.id, profile.display_name || profile.email || "Someone");
    }
  }

  return Response.json({
    entries: rows.map((row) => ({
      ...row,
      actor: row.actor_id ? (names.get(row.actor_id) ?? "A former member") : "Teamski",
    })),
  });
}
