import { createClient } from "@/lib/supabase/server";

import { adminClient } from "@/lib/supabase/admin";

import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";


// ==========================================
// DELETING AN ACCOUNT
// ==========================================
//
// What goes, and what stays:
//
//   Gone      your profile, sign-in, plan, API keys
//             (your own and any you shared with a
//             project), connected apps, the
//             messages you wrote in channels and
//             DMs, and projects nobody else is in.
//
//   Stays     projects other people are in. They
//             are handed to another member rather
//             than deleted, so a team does not lose
//             its work because one person left. The
//             agents' replies there stay too.
//
// Everything is done with the service role,
// because a person cannot delete their own sign-in
// through row level security, and in an order
// that leaves nothing pointing at a user that no
// longer exists. Each step is best effort except
// the last: if the sign-in itself cannot be
// deleted, the request fails and says so.
//

type Db = SupabaseClient;

type Step = { step: string; error?: string };


async function run(
  log: Step[],
  step: string,
  work: () => PromiseLike<{ error: { message: string; code?: string } | null }>
) {
  const { error } = await work();

  // A table from a migration that was never run
  // has nothing of theirs in it.

  const missing =
    error &&
    (error.code === "42P01" ||
      error.code === "PGRST205" ||
      error.code === "42703");

  log.push({
    step,
    ...(error && !missing ? { error: error.message } : {}),
  });
}


async function handOverProjects(db: Db, userId: string, log: Step[]) {
  const { data: owned } = await db
    .from("project_members")
    .select("project_id")
    .eq("user_id", userId)
    .eq("role", "owner");

  const deleted: string[] = [];

  for (const { project_id: projectId } of (owned ?? []) as {
    project_id: string;
  }[]) {
    const { data: others } = await db
      .from("project_members")
      .select("user_id, role")
      .eq("project_id", projectId)
      .neq("user_id", userId);

    const rest = (others ?? []) as { user_id: string; role: string }[];

    if (rest.length === 0) {
      deleted.push(projectId);
      continue;
    }

    // Another owner already? They keep it.
    // Otherwise the first other member takes it.

    const heir =
      rest.find((member) => member.role === "owner") ?? rest[0];

    if (heir.role !== "owner") {
      await run(log, `hand over project ${projectId}`, () =>
        db
          .from("project_members")
          .update({ role: "owner" })
          .eq("project_id", projectId)
          .eq("user_id", heir.user_id)
      );
    }

    // The project row points at whoever created it,
    // and deleting that sign-in takes the project
    // with it. Found by testing: the whole shared
    // project vanished. So it points at the heir.

    await run(log, `re-home project ${projectId}`, () =>
      db
        .from("projects")
        .update({ created_by: heir.user_id })
        .eq("id", projectId)
        .eq("created_by", userId)
    );
  }

  // Projects they created but no longer own - the
  // owner changed hands earlier - would go the same
  // way. Point each at a current owner.

  const { data: created } = await db
    .from("projects")
    .select("id")
    .eq("created_by", userId);

  for (const { id: projectId } of (created ?? []) as { id: string }[]) {
    if (deleted.includes(projectId)) {
      continue;
    }

    const { data: owner } = await db
      .from("project_members")
      .select("user_id")
      .eq("project_id", projectId)
      .eq("role", "owner")
      .neq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (owner) {
      await run(log, `re-home project ${projectId}`, () =>
        db
          .from("projects")
          .update({ created_by: (owner as { user_id: string }).user_id })
          .eq("id", projectId)
      );
    }
  }

  // Files first: the storage objects are not
  // removed by deleting their rows.

  for (const projectId of deleted) {
    const { data: files } = await db
      .from("attachments")
      .select("storage_path")
      .eq("project_id", projectId);

    const paths = ((files ?? []) as { storage_path: string }[]).map(
      (file) => file.storage_path
    );

    if (paths.length > 0) {
      await db.storage.from("attachments").remove(paths);
    }

    await run(log, `delete project ${projectId}`, () =>
      db.from("projects").delete().eq("id", projectId)
    );
  }

  return deleted.length;
}


export async function DELETE(request: Request) {
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

  const body = (await request
    .json()
    .catch(() => ({}))) as { confirm?: string };

  // Typed, not clicked. There is no undo.

  if ((body.confirm ?? "").trim().toLowerCase() !== "delete") {
    return Response.json(
      { error: 'Type "delete" to confirm.' },
      { status: 400 }
    );
  }

  const admin = adminClient() as unknown as Db | null;

  if (!admin) {
    return Response.json(
      {
        error:
          "Account deletion is not available on this server. Email support to have your account deleted.",
      },
      { status: 503 }
    );
  }

  const id = user.id;
  const log: Step[] = [];

  const projectsDeleted = await handOverProjects(admin, id, log);

  // Their own files in projects that stay.

  const { data: files } = await admin
    .from("attachments")
    .select("storage_path")
    .eq("uploaded_by", id);

  const paths = ((files ?? []) as { storage_path: string }[]).map(
    (file) => file.storage_path
  );

  if (paths.length > 0) {
    await admin.storage.from("attachments").remove(paths);
  }

  await run(log, "attachments", () =>
    admin.from("attachments").delete().eq("uploaded_by", id)
  );

  await run(log, "messages", () =>
    admin.from("messages").delete().eq("user_id", id)
  );

  await run(log, "dm messages", () =>
    admin.from("dm_messages").delete().eq("user_id", id)
  );

  await run(log, "dm memberships", () =>
    admin.from("dm_members").delete().eq("user_id", id)
  );

  // A key they shared is their card, even if the
  // project stays.

  await run(log, "shared keys", () =>
    admin.from("project_model_keys").delete().eq("added_by", id)
  );

  await run(log, "connections and model keys", () =>
    admin.from("connections").delete().eq("user_id", id)
  );

  await run(log, "apps", () =>
    admin.from("mcp_servers").delete().eq("user_id", id)
  );

  await run(log, "notifications", () =>
    admin.from("notifications").delete().eq("user_id", id)
  );

  await run(log, "plan", () =>
    admin.from("subscriptions").delete().eq("user_id", id)
  );

  await run(log, "memberships", () =>
    admin.from("project_members").delete().eq("user_id", id)
  );

  if (user.email) {
    await run(log, "pending invites to them", () =>
      admin.from("project_invites").delete().ilike("email", user.email!)
    );
  }

  await run(log, "profile", () =>
    admin.from("profiles").delete().eq("id", id)
  );

  // The one that has to work.

  const { error } = await admin.auth.admin.deleteUser(id);

  const problems = log.filter((entry) => entry.error);

  if (problems.length > 0) {
    console.error("Account deletion issues:", id, problems);
  }

  if (error) {
    console.error("Could not delete sign-in:", id, error.message);

    return Response.json(
      {
        error:
          "Your data was removed, but the sign-in itself could not be deleted. Email support and we will finish it.",
      },
      { status: 500 }
    );
  }

  return Response.json({
    ok: true,
    projectsDeleted,
  });
}
