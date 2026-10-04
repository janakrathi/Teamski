import { createClient } from "@/lib/supabase/server";

import { adminClient } from "@/lib/supabase/admin";

import { audit } from "@/lib/audit";

import { can, roleInProject } from "@/lib/plans";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


// ==========================================
// WHO CAN SEE A CHANNEL
// ==========================================
//
// A channel is open (everyone in the project, viewers
// read-only) or private (only the people listed). Owners
// and admins see everything. See migrations 0034, 0035.
//
// Read by anyone who can see the channel; changed by an
// owner or admin, through the service role after the
// check here.
//

export async function GET(request: Request, context: RouteContext) {
  const { id: projectId } = await context.params;

  const channelId = new URL(request.url).searchParams.get("channelId") ?? "";

  if (!uuidRegex.test(projectId) || !uuidRegex.test(channelId)) {
    return Response.json({ error: "Which channel?" }, { status: 400 });
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "You must be logged in." }, { status: 401 });
  }

  // Through the caller's own client: no row means they
  // cannot see the channel.
  const { data: channel, error } = await supabase
    .from("channels")
    .select("id, name, restricted")
    .eq("id", channelId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) {
    return Response.json(
      {
        error:
          error.code === "42703" || error.code === "PGRST204"
            ? "Run supabase/migrations/0034_viewers_private_channels.sql to enable private channels."
            : error.message,
        needsMigration: error.code === "42703" || error.code === "PGRST204",
      },
      { status: error.code === "42703" || error.code === "PGRST204" ? 400 : 500 }
    );
  }

  if (!channel) {
    return Response.json({ error: "Channel not found." }, { status: 404 });
  }

  const { data: listed } = await supabase
    .from("channel_members")
    .select("user_id")
    .eq("channel_id", channelId);

  const role = await roleInProject(supabase, projectId, user.id);

  return Response.json({
    restricted: Boolean(channel.restricted),
    userIds: (listed ?? []).map((row) => row.user_id as string),
    canManage: can(role, "manage_members"),
  });
}


export async function PUT(request: Request, context: RouteContext) {
  const { id: projectId } = await context.params;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "You must be logged in." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    channelId?: string;
    restricted?: boolean;
    userIds?: unknown;
  };

  const channelId = body.channelId ?? "";

  if (!uuidRegex.test(projectId) || !uuidRegex.test(channelId)) {
    return Response.json({ error: "Which channel?" }, { status: 400 });
  }

  const role = await roleInProject(supabase, projectId, user.id);

  if (!can(role, "manage_members")) {
    return Response.json(
      { error: "Only an owner or admin can change who sees a channel." },
      { status: 403 }
    );
  }

  const admin = adminClient();

  if (!admin) {
    return Response.json(
      { error: "Channel access is not available on this server." },
      { status: 503 }
    );
  }

  const { data: channel } = await admin
    .from("channels")
    .select("id, name")
    .eq("id", channelId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!channel) {
    return Response.json({ error: "Channel not found." }, { status: 404 });
  }

  // Only people actually in the project can be listed.
  const wanted = Array.isArray(body.userIds)
    ? body.userIds.filter(
        (id): id is string => typeof id === "string" && uuidRegex.test(id)
      )
    : [];

  const { data: members } = await admin
    .from("project_members")
    .select("user_id")
    .eq("project_id", projectId)
    .in("user_id", wanted.length > 0 ? wanted : ["00000000-0000-0000-0000-000000000000"]);

  const userIds = ((members ?? []) as { user_id: string }[]).map((row) => row.user_id);

  const restricted = body.restricted === true;

  const { error: updateError } = await admin
    .from("channels")
    .update({ restricted } as never)
    .eq("id", channelId);

  if (updateError) {
    const missing = updateError.code === "42703" || updateError.code === "PGRST204";

    return Response.json(
      {
        error: missing
          ? "Run supabase/migrations/0034_viewers_private_channels.sql to enable private channels."
          : updateError.message,
        needsMigration: missing,
      },
      { status: missing ? 400 : 500 }
    );
  }

  // Replace the list: remove whoever is no longer on it,
  // add whoever is new.
  const { data: current } = await admin
    .from("channel_members")
    .select("user_id")
    .eq("channel_id", channelId);

  const before = ((current ?? []) as { user_id: string }[]).map((row) => row.user_id);

  const removed = before.filter((id) => !userIds.includes(id));
  const added = userIds.filter((id) => !before.includes(id));

  if (removed.length > 0) {
    await admin
      .from("channel_members")
      .delete()
      .eq("channel_id", channelId)
      .in("user_id", removed);
  }

  if (added.length > 0) {
    const { error } = await admin.from("channel_members").insert(
      added.map((id) => ({
        channel_id: channelId,
        user_id: id,
        added_by: user.id,
      })) as never
    );

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  await audit({
    projectId,
    actorId: user.id,
    action: "channel.access",
    target: `#${(channel as { name: string }).name}`,
    details: { restricted, added: added.length, removed: removed.length },
  });

  return Response.json({ ok: true, restricted, userIds });
}
