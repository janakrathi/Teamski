import { templateById } from "@/lib/agents/templates";

import { createClient } from "@/lib/supabase/server";

import { audit } from "@/lib/audit";

import { can, roleInProject } from "@/lib/plans";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


// ==========================================
// LIST CHANNELS
// ==========================================

export async function GET(
  _request: Request,
  context: RouteContext
) {
  const { id: projectId } = await context.params;

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

  if (!uuidRegex.test(projectId)) {
    return Response.json(
      { error: "Invalid project ID." },
      { status: 400 }
    );
  }

  // Private channels (0034) say so; before that
  // migration there is no column to read.
  const list = (columns: string) =>
    supabase
      .from("channels")
      .select(columns)
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });

  let result = await list("id, project_id, name, created_at, restricted");

  if (
    result.error &&
    (result.error.code === "42703" || result.error.code === "PGRST204")
  ) {
    result = await list("id, project_id, name, created_at");
  }

  const { data, error } = result;

  if (error) {
    console.error(
      "Failed to load channels:",
      error
    );

    return Response.json(
      {
        error: error.message,

        // The migration in supabase/migrations
        // has not been run yet. Postgres says
        // 42P01 for a missing table, while
        // PostgREST says PGRST205 when the table
        // is absent from its schema cache.
        needsMigration:
          error.code === "42P01" ||
          error.code === "PGRST205" ||
          error.message.includes(
            "does not exist"
          ) ||
          error.message.includes(
            "schema cache"
          ),
      },
      { status: 500 }
    );
  }

  // The caller's role, so a viewer gets a read-only
  // channel without a second request.
  const role = await roleInProject(supabase, projectId, user.id);

  return Response.json({
    channels: data ?? [],
    role,
  });
}


// ==========================================
// CREATE CHANNEL
// ==========================================

export async function POST(
  request: Request,
  context: RouteContext
) {
  const { id: projectId } = await context.params;

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

  if (!uuidRegex.test(projectId)) {
    return Response.json(
      { error: "Invalid project ID." },
      { status: 400 }
    );
  }

  const body = (await request
    .json()
    .catch(() => ({}))) as {
    name?: string;
    templateId?: string | null;
  };

  const role = await roleInProject(supabase, projectId, user.id);

  if (!can(role, "use")) {
    return Response.json(
      {
        error: role
          ? "Viewers cannot create channels."
          : "You are not a member of this project.",
      },
      { status: 403 }
    );
  }

  const template = templateById(body.templateId);

  // Channel names are shown with a leading #,
  // so store them without one.

  const name =
    typeof body.name === "string"
      ? body.name
          .trim()
          .replace(/^#+/, "")
          .replace(/\s+/g, "-")
          .toLowerCase()
          .slice(0, 40)
      : "";

  if (!name) {
    return Response.json(
      { error: "A channel name is required." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("channels")
    .insert({
      project_id: projectId,
      name,
      created_by: user.id,
    })
    .select("id, project_id, name, created_at")
    .single();

  if (error) {
    return Response.json(
      {
        error:
          error.code === "23505"
            ? `#${name} already exists in this project.`
            : error.message,
      },
      { status: 500 }
    );
  }

  // A channel without an agent is a room with
  // nobody in it, so give it one straight away,
  // named after the channel.

  // Or, when a template was picked, the agent
  // that template describes.

  const agent = {
    project_id: projectId,
    channel_id: data.id,
    name:
      template?.agentName ??
      `${name
        .replace(/-/g, " ")
        .replace(/\b\w/g, (letter) =>
          letter.toUpperCase()
        )} agent`,
    description: template
      ? template.tagline
      : `The agent for #${name}.`,
    instructions: template?.instructions ?? null,
    status: "idle",
    provider: "ollama",
    created_by: user.id,
  };

  let { error: agentError } = await supabase
    .from("agents")
    .insert({
      ...agent,
      template_id: template?.id ?? null,
    });

  // Before migration 0022 there is nowhere to
  // record the template. The instructions still
  // matter more than the label.

  if (
    agentError &&
    (agentError.code === "42703" ||
      agentError.code === "PGRST204")
  ) {
    ({ error: agentError } = await supabase
      .from("agents")
      .insert(agent));
  }

  if (agentError) {
    // The channel is still usable; it just falls
    // back to the project agent until the
    // migration adding channel_id has been run.

    console.error(
      "Could not create the channel's agent:",
      agentError.message
    );
  }

  await audit({
    projectId,
    actorId: user.id,
    action: "channel.create",
    target: `#${name}`,
  });

  return Response.json({ channel: data });
}


// Channel names are shown with a leading #, so they are
// stored without one, spaces become dashes, lowercased,
// capped - the same shape a new channel is given.
function cleanChannelName(raw: unknown): string {
  return typeof raw === "string"
    ? raw
        .trim()
        .replace(/^#+/, "")
        .replace(/\s+/g, "-")
        .toLowerCase()
        .slice(0, 40)
    : "";
}


// ==========================================
// RENAME A CHANNEL
// ==========================================

export async function PATCH(
  request: Request,
  context: RouteContext
) {
  const { id: projectId } = await context.params;

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

  if (!uuidRegex.test(projectId)) {
    return Response.json(
      { error: "Invalid project ID." },
      { status: 400 }
    );
  }

  const body = (await request
    .json()
    .catch(() => ({}))) as {
    channelId?: string;
    name?: string;
  };

  if (!body.channelId) {
    return Response.json(
      { error: "Which channel?" },
      { status: 400 }
    );
  }

  const name = cleanChannelName(body.name);

  if (!name) {
    return Response.json(
      { error: "A channel name is required." },
      { status: 400 }
    );
  }

  const role = await roleInProject(supabase, projectId, user.id);

  if (!can(role, "use")) {
    return Response.json(
      { error: "Viewers cannot rename channels." },
      { status: 403 }
    );
  }

  const { data: before } = await supabase
    .from("channels")
    .select("name")
    .eq("id", body.channelId)
    .eq("project_id", projectId)
    .maybeSingle();

  // Row-level security lets only a project member do
  // this, and scopes it to this project's channels.
  const { data, error } = await supabase
    .from("channels")
    .update({ name })
    .eq("id", body.channelId)
    .eq("project_id", projectId)
    .select("id, project_id, name, created_at")
    .single();

  if (error) {
    return Response.json(
      {
        error:
          error.code === "23505"
            ? `#${name} already exists in this project.`
            : error.message,
      },
      { status: 500 }
    );
  }

  await audit({
    projectId,
    actorId: user.id,
    action: "channel.rename",
    target: `#${name}`,
    details: { from: before?.name ?? null },
  });

  return Response.json({ channel: data });
}


// ==========================================
// DELETE A CHANNEL
// ==========================================

export async function DELETE(
  request: Request,
  context: RouteContext
) {
  const { id: projectId } = await context.params;

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

  if (!uuidRegex.test(projectId)) {
    return Response.json(
      { error: "Invalid project ID." },
      { status: 400 }
    );
  }

  const channelId = new URL(
    request.url
  ).searchParams.get("channelId");

  if (!channelId) {
    return Response.json(
      { error: "Which channel?" },
      { status: 400 }
    );
  }

  const role = await roleInProject(supabase, projectId, user.id);

  if (!can(role, "use")) {
    return Response.json(
      { error: "Viewers cannot delete channels." },
      { status: 403 }
    );
  }

  const { data: doomed } = await supabase
    .from("channels")
    .select("name")
    .eq("id", channelId)
    .eq("project_id", projectId)
    .maybeSingle();

  // The channel's messages, agent and memory go with it
  // through the database's cascade. Row-level security
  // lets only a project member remove it.
  const { error } = await supabase
    .from("channels")
    .delete()
    .eq("id", channelId)
    .eq("project_id", projectId);

  if (error) {
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }

  if (doomed) {
    await audit({
      projectId,
      actorId: user.id,
      action: "channel.delete",
      target: `#${doomed.name}`,
    });
  }

  return Response.json({ ok: true });
}
