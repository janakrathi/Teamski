import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";


// ==========================================
// YOUR PROFILE
// ==========================================
//
// A name people read and a handle people type.
// Row level security keeps the write to your own
// row; this route only decides what a valid
// answer looks like.
//

const HANDLE = /^[a-zA-Z0-9_.-]{2,24}$/;

// Names that would make a mention ambiguous.
// "agent" already addresses the AI.

const RESERVED = new Set([
  "agent",
  "everyone",
  "channel",
  "here",
  "all",
]);


function needsMigration(code?: string) {
  return (
    code === "42703" ||
    code === "PGRST204" ||
    code === "42P01"
  );
}


export async function GET() {
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

  const { data, error } = await db
    .from("profiles")
    .select(
      "id, email, display_name, username, avatar_url"
    )
    .eq("id", user.id)
    .maybeSingle();

  // Before migration 0011 there is no username
  // column. Answer with what does exist rather
  // than failing the whole settings panel.

  if (error && needsMigration(error.code)) {
    const { data: older } = await db
      .from("profiles")
      .select("id, email, display_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle();

    return Response.json({
      profile: {
        ...(older ?? {
          id: user.id,
          email: user.email,
        }),
        username: null,
      },

      needsMigration: true,
    });
  }

  if (error) {
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return Response.json({
    profile: data ?? {
      id: user.id,
      email: user.email,
      display_name: null,
      username: null,
      avatar_url: null,
    },
  });
}


export async function PATCH(request: Request) {
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
    display_name?: string;
    username?: string;
  };

  const patch: Record<string, string | null> = {};

  if (body.display_name !== undefined) {
    const name = body.display_name.trim();

    if (name.length > 60) {
      return Response.json(
        {
          error:
            "That name is too long - 60 characters at most.",
        },
        { status: 400 }
      );
    }

    patch.display_name = name || null;
  }

  if (body.username !== undefined) {
    const handle = body.username.trim();

    if (handle) {
      if (!HANDLE.test(handle)) {
        return Response.json(
          {
            error:
              "A username is 2 to 24 characters, using letters, numbers, dots, dashes or underscores.",
          },
          { status: 400 }
        );
      }

      if (RESERVED.has(handle.toLowerCase())) {
        return Response.json(
          {
            error: `"${handle}" is reserved - it would make a mention ambiguous.`,
          },
          { status: 400 }
        );
      }
    }

    patch.username = handle || null;
  }

  if (Object.keys(patch).length === 0) {
    return Response.json(
      { error: "Nothing to change." },
      { status: 400 }
    );
  }

  const { data, error } = await db
    .from("profiles")
    .update(patch)
    .eq("id", user.id)
    .select(
      "id, email, display_name, username, avatar_url"
    )
    .single();

  if (error) {
    // 23505 is the unique index on lower(username).

    if (error.code === "23505") {
      return Response.json(
        {
          error:
            "Somebody already has that username.",
        },
        { status: 409 }
      );
    }

    if (needsMigration(error.code)) {
      return Response.json(
        {
          error:
            "Run supabase/migrations/0011_identity.sql to enable usernames.",
          needsMigration: true,
        },
        { status: 400 }
      );
    }

    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return Response.json({ profile: data });
}
