import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


// ==========================================
// A CHANNEL'S AGENT
// ==========================================
//
// Each channel has one. Its instructions are what
// make #research answer differently from #design
// without anyone restating it every message.
//

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const channelId =
    searchParams.get("channelId") || "";

  if (!uuidRegex.test(channelId)) {
    return Response.json(
      { error: "A valid channelId is required." },
      { status: 400 }
    );
  }

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

  const read = (columns: string) =>
    db
      .from("agents")
      .select(columns)
      .eq("channel_id", channelId)
      .maybeSingle();

  let { data, error } = await read(
    "id, name, description, instructions, model, status, template_id"
  );

  // Without migration 0022 there is no template
  // to report, and everything else still is.

  if (
    error &&
    (error.code === "42703" ||
      error.code === "PGRST204")
  ) {
    ({ data, error } = await read(
      "id, name, description, instructions, model, status"
    ));
  }

  if (error) {
    return Response.json(
      {
        error: error.message,

        needsMigration:
          error.code === "42703" ||
          error.code === "PGRST204" ||
          error.code === "42501",
      },
      { status: 500 }
    );
  }

  return Response.json({ agent: data ?? null });
}


// ==========================================
// SAVE
// ==========================================

export async function PATCH(request: Request) {
  const { searchParams } = new URL(request.url);

  const channelId =
    searchParams.get("channelId") || "";

  if (!uuidRegex.test(channelId)) {
    return Response.json(
      { error: "A valid channelId is required." },
      { status: 400 }
    );
  }

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
    name?: string;
    instructions?: string;
    model?: string;
  };

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof body.name === "string") {
    patch.name =
      body.name.trim().slice(0, 60) || "Agent";
  }

  if (typeof body.instructions === "string") {
    patch.instructions = body.instructions
      .trim()
      .slice(0, 4000);
  }

  if (typeof body.model === "string") {
    patch.model = body.model.trim().slice(0, 80);
  }

  const { data, error } = await db
    .from("agents")
    .update(patch)
    .eq("channel_id", channelId)
    .select(
      "id, name, description, instructions, model, status"
    )
    .maybeSingle();

  if (error) {
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return Response.json({ agent: data });
}
