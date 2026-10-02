import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

import { adminClient } from "@/lib/supabase/admin";

import { startTrial } from "@/lib/payments/subscription";

import { SELF_HOSTED } from "@/lib/plans";

export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return Response.json(
        {
          error: userError?.message || "You must be logged in.",
        },
        { status: 401 }
      );
    }

    // Anything waiting for this address becomes
    // membership before the list is read, so an
    // invited person sees the project on their
    // first visit rather than an empty app.
    //
    // Returns fast when there is nothing waiting,
    // and an older database without the function
    // is simply a database with no invites.

    await supabase
      .rpc("claim_invites")
      .then(undefined, () => undefined);

    const { data, error } = await supabase
      .from("projects")
      .select("id, name, created_at")
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      return Response.json(
        {
          error: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        },
        { status: 500 }
      );
    }

    return Response.json({
      projects: data ?? [],
    });
  } catch (error) {
    console.error("PROJECT API CRASH:", error);

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown server error",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return Response.json(
        {
          error: userError?.message || "You must be logged in.",
        },
        { status: 401 }
      );
    }

    const body = await request.json();

    const name =
      typeof body.name === "string"
        ? body.name.trim()
        : "";

    if (!name) {
      return Response.json(
        {
          error: "Project name is required.",
        },
        { status: 400 }
      );
    }

    // A project can only be read by its members, and
    // at the moment it is created it has none. So
    // asking for the new row back in the same insert
    // fails row level security ("new row violates
    // row-level security policy"), and so does the
    // creator adding themselves as owner - that
    // policy wants an owner to already exist.
    //
    // So the id is made here, the project is
    // inserted as the person (RLS still checks
    // created_by is them), and the owner membership
    // is written with the service role, which is
    // safe because the user was verified above and
    // only ever becomes owner of the row they just
    // created.

    const project = {
      id: crypto.randomUUID(),
      name,
      created_at: new Date().toISOString(),
    };

    const { error: projectError } = await supabase
      .from("projects")
      .insert({
        id: project.id,
        name,
        created_by: user.id,
        created_at: project.created_at,
      });

    if (projectError) {
      return Response.json(
        {
          error: projectError.message,
          details: projectError.details,
          hint: projectError.hint,
          code: projectError.code,
        },
        { status: 500 }
      );
    }

    const admin = adminClient() as unknown as SupabaseClient | null;

    const { error: membershipError } = await (admin ?? supabase)
      .from("project_members")
      .insert({
        project_id: project.id,
        user_id: user.id,
        role: "owner",
      });

    if (membershipError) {
      // Nobody could ever open a project without an
      // owner, so it goes rather than lingering.

      await admin?.from("projects").delete().eq("id", project.id);

      return Response.json(
        {
          error: membershipError.message,
          details: membershipError.details,
          hint: membershipError.hint,
          code: membershipError.code,
        },
        { status: 500 }
      );
    }

    // Launch promo: the new project starts on Team free
    // for two months, then lapses to Free on its own.
    // Best effort - a project with no trial row just runs
    // on Free, so this never fails creation.
    // A self-hosted copy has everything already.
    if (admin && !SELF_HOSTED) {
      await startTrial(admin, {
        projectId: project.id,
        ownerId: user.id,
      });
    }

    return Response.json({
      project,
    });
  } catch (error) {
    console.error(
      "PROJECT POST CRASH:",
      error
    );

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown server error",
      },
      { status: 500 }
    );
  }
}


// ==========================================
// RENAME A PROJECT
// ==========================================

export async function PATCH(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json(
      { error: "You must be logged in." },
      { status: 401 }
    );
  }

  const body = (await request
    .json()
    .catch(() => ({}))) as {
    id?: string;
    name?: string;
  };

  const name =
    typeof body.name === "string"
      ? body.name.trim().slice(0, 60)
      : "";

  if (!body.id || !name) {
    return Response.json(
      { error: "A project name is required." },
      { status: 400 }
    );
  }

  // Row-level security decides who may rename it - the
  // owner's write goes through, anyone else's does not.
  const { data, error } = await supabase
    .from("projects")
    .update({ name })
    .eq("id", body.id)
    .select("id, name, created_at")
    .single();

  if (error) {
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return Response.json({ project: data });
}