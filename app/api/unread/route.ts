import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";


// ==========================================
// UNREAD
// ==========================================
//
// Where each conversation stands relative to
// where you last looked. Two grouped counts, one
// round trip - the sidebar polls this, so it can
// not be a query per channel.
//
// Both counts are computed inside the database
// under the caller's own identity, so there is
// no way to ask this endpoint about anybody
// else.
//

// The tables land with migration 0010. Until
// then the sidebar should quietly show nothing
// rather than an error on every poll.

function isMissingSchema(code?: string) {
  return (
    code === "42P01" ||
    code === "42883" ||
    code === "PGRST202" ||
    code === "PGRST205" ||
    code === "42501"
  );
}


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

  const projectId = new URL(
    request.url
  ).searchParams.get("projectId");

  const [channelResult, dmResult] =
    await Promise.all([
      projectId
        ? db.rpc("unread_channels", {
            p_project_id: projectId,
          })
        : Promise.resolve({
            data: [],
            error: null,
          }),

      db.rpc("unread_dms"),
    ]);

  const failure =
    channelResult.error ?? dmResult.error;

  if (failure) {
    if (isMissingSchema(failure.code)) {
      return Response.json({
        channels: {},
        dms: {},
        needsMigration: true,
      });
    }

    return Response.json(
      { error: failure.message },
      { status: 500 }
    );
  }

  // Keyed for lookup, since that is the only way
  // the sidebar uses them.

  const channels: Record<string, number> = {};

  for (const row of (channelResult.data ??
    []) as {
    channel_id: string;
    unread: number;
  }[]) {
    if (row.unread > 0) {
      channels[row.channel_id] = Number(
        row.unread
      );
    }
  }

  // Keyed by the person, not the conversation -
  // the sidebar lists teammates.

  const dms: Record<string, number> = {};

  for (const row of (dmResult.data ?? []) as {
    other_user_id: string;
    unread: number;
  }[]) {
    if (row.unread > 0) {
      dms[row.other_user_id] = Number(row.unread);
    }
  }

  return Response.json({ channels, dms });
}


// ==========================================
// MARK READ
// ==========================================
//
// Called when you open something, and again
// while you are sitting in it and something new
// arrives.
//

export async function POST(request: Request) {
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
    .catch(() => ({}))) as {
    channelId?: string;
    conversationId?: string;
  };

  const now = new Date().toISOString();

  // Two tables rather than one polymorphic
  // upsert: the schemas differ and the typed
  // client is happier being told which is which.

  const { error } = body.channelId
    ? await db.from("channel_reads").upsert(
        {
          user_id: user.id,
          channel_id: body.channelId,
          last_read_at: now,
        },
        { onConflict: "user_id,channel_id" }
      )
    : body.conversationId
      ? await db.from("dm_reads").upsert(
          {
            user_id: user.id,
            conversation_id: body.conversationId,
            last_read_at: now,
          },
          {
            onConflict:
              "user_id,conversation_id",
          }
        )
      : {
          error: {
            code: "missing_target",
            message:
              "Say which channel or conversation was read.",
          },
        };

  if (error) {
    if (error.code === "missing_target") {
      return Response.json(
        { error: error.message },
        { status: 400 }
      );
    }

    if (isMissingSchema(error.code)) {
      return Response.json({
        ok: false,
        needsMigration: true,
      });
    }

    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return Response.json({ ok: true });
}
