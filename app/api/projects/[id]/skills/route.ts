import { createClient } from "@/lib/supabase/server";

import { adminClient } from "@/lib/supabase/admin";

import { audit } from "@/lib/audit";

import { can, roleInProject } from "@/lib/plans";

import { findSkills, refreshSkills } from "@/lib/ai/skills";

import { githubToken } from "@/lib/connections/github";

import type { SupabaseClient } from "@supabase/supabase-js";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const NEEDS_MIGRATION = {
  error: "Run supabase/migrations/0034_viewers_private_channels.sql to enable skills.",
  needsMigration: true,
};

const missingTable = (error: { code?: string } | null) =>
  error?.code === "42P01" || error?.code === "PGRST205";


// ==========================================
// PROJECT SKILLS
// ==========================================
//
// Skills from GitHub repos (see lib/ai/skills.ts).
// Everyone in the project sees the list and their
// agents use them; an owner or admin adds, turns off or
// removes them.
//

async function signedIn(projectId: string) {
  const db = await createClient();

  const {
    data: { user },
  } = await db.auth.getUser();

  const role =
    user && uuidRegex.test(projectId)
      ? await roleInProject(db as unknown as SupabaseClient, projectId, user.id)
      : null;

  return { db, user, role };
}


export async function GET(_request: Request, context: RouteContext) {
  const { id: projectId } = await context.params;

  const { db, user, role } = await signedIn(projectId);

  if (!user) {
    return Response.json({ error: "You must be logged in." }, { status: 401 });
  }

  if (!role) {
    return Response.json({ error: "You are not in this project." }, { status: 403 });
  }

  const { data, error } = await db
    .from("project_skills")
    .select("id, name, description, source, enabled, created_at")
    .eq("project_id", projectId)
    .order("name");

  if (error) {
    return Response.json(missingTable(error) ? NEEDS_MIGRATION : { error: error.message }, {
      status: missingTable(error) ? 400 : 500,
    });
  }

  return Response.json({
    skills: data ?? [],
    canManage: can(role, "manage_settings"),
  });
}


// Add every skill in a repo link. One already there by
// the same name is refreshed from the repo.
export async function POST(request: Request, context: RouteContext) {
  const { id: projectId } = await context.params;

  const { db, user, role } = await signedIn(projectId);

  if (!user) {
    return Response.json({ error: "You must be logged in." }, { status: 401 });
  }

  if (!can(role, "manage_settings")) {
    return Response.json(
      { error: "Only an owner or admin can add skills." },
      { status: 403 }
    );
  }

  const admin = adminClient();

  if (!admin) {
    return Response.json({ error: "Skills are not available on this server." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    url?: string;
    refresh?: boolean;
  };

  // Refresh: re-read every skill here from the file it
  // came from, with each adder's GitHub connection for
  // private repos.
  if (body.refresh) {
    const synced = await refreshSkills(admin as unknown as SupabaseClient, {
      projectId,
      tokenFor: async (userId) => {
        const found = await githubToken(admin as unknown as SupabaseClient, userId).catch(
          () => null
        );

        return found && found.ok ? found.token : null;
      },
    });

    await audit({
      projectId,
      actorId: user.id,
      action: "skill.refresh",
      details: { updated: synced.updated.length, failed: synced.failed.length },
    });

    return Response.json({ ok: true, ...synced });
  }

  const url = (body.url ?? "").trim();

  if (!url) {
    return Response.json({ error: "Paste a GitHub repository link." }, { status: 400 });
  }

  // Their own GitHub connection reaches their private
  // repos and has a far higher rate limit; a server
  // token is the fallback; public repos work with
  // neither.
  const own = await githubToken(db as unknown as SupabaseClient, user.id).catch(() => null);

  const token = own && own.ok ? own.token : (process.env.GITHUB_TOKEN ?? null);

  const found = await findSkills(url, token);

  if ("error" in found) {
    return Response.json({ error: found.error }, { status: 400 });
  }

  const now = new Date().toISOString();

  const { error } = await admin.from("project_skills").upsert(
    found.skills.map((skill) => ({
      project_id: projectId,
      name: skill.name,
      description: skill.description,
      body: skill.body,
      source: skill.source,
      enabled: true,
      added_by: user.id,
      updated_at: now,
    })) as never,
    { onConflict: "project_id,name" }
  );

  if (error) {
    return Response.json(missingTable(error) ? NEEDS_MIGRATION : { error: error.message }, {
      status: missingTable(error) ? 400 : 500,
    });
  }

  for (const skill of found.skills) {
    await audit({
      projectId,
      actorId: user.id,
      action: "skill.add",
      target: skill.name,
      details: { source: skill.source },
    });
  }

  return Response.json({
    ok: true,
    added: found.skills.map((skill) => skill.name),
  });
}


export async function PATCH(request: Request, context: RouteContext) {
  const { id: projectId } = await context.params;

  const { user, role } = await signedIn(projectId);

  if (!user) {
    return Response.json({ error: "You must be logged in." }, { status: 401 });
  }

  if (!can(role, "manage_settings")) {
    return Response.json(
      { error: "Only an owner or admin can change skills." },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as { id?: string; enabled?: boolean };

  const admin = adminClient();

  if (!admin || !uuidRegex.test(body.id ?? "")) {
    return Response.json({ error: "Which skill?" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("project_skills")
    .update({ enabled: body.enabled !== false, updated_at: new Date().toISOString() } as never)
    .eq("id", body.id!)
    .eq("project_id", projectId)
    .select("name");

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const name = ((data ?? []) as { name: string }[])[0]?.name;

  if (name) {
    await audit({
      projectId,
      actorId: user.id,
      action: "skill.toggle",
      target: name,
      details: { enabled: body.enabled !== false },
    });
  }

  return Response.json({ ok: true });
}


export async function DELETE(request: Request, context: RouteContext) {
  const { id: projectId } = await context.params;

  const { user, role } = await signedIn(projectId);

  if (!user) {
    return Response.json({ error: "You must be logged in." }, { status: 401 });
  }

  if (!can(role, "manage_settings")) {
    return Response.json(
      { error: "Only an owner or admin can remove skills." },
      { status: 403 }
    );
  }

  const skillId = new URL(request.url).searchParams.get("id") ?? "";

  const admin = adminClient();

  if (!admin || !uuidRegex.test(skillId)) {
    return Response.json({ error: "Which skill?" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("project_skills")
    .delete()
    .eq("id", skillId)
    .eq("project_id", projectId)
    .select("name");

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const name = ((data ?? []) as { name: string }[])[0]?.name;

  if (name) {
    await audit({ projectId, actorId: user.id, action: "skill.remove", target: name });
  }

  return Response.json({ ok: true });
}
