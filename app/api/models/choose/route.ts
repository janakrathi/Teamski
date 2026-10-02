import { createClient } from "@/lib/supabase/server";

import {
  GROQ_DEFAULT_MODEL,
  groqKey,
} from "@/lib/ai/providers/groq";

import {
  CEREBRAS_DEFAULT_MODEL,
  cerebrasKey,
} from "@/lib/ai/providers/cerebras";

export const dynamic = "force-dynamic";


// ==========================================
// CHOOSING WHICH MODEL ANSWERS
// ==========================================
//
// In a channel this is a shared decision, and
// deliberately so. A channel's agent has one
// name, one set of instructions and one memory;
// giving it a different model per person would
// make "the design agent" a different thing
// depending on who spoke to it.
//
// Outside a channel it is yours, and it lives on
// your profile rather than in the browser - so
// signing in on a phone does not silently change
// which model answers.
//

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

  const channelId = new URL(
    request.url
  ).searchParams.get("channelId");

  if (channelId) {
    const { data: agent } = await db
      .from("agents")
      .select("model")
      .eq("channel_id", channelId)
      .maybeSingle();

    // A channel with no model of its own defers
    // to whoever is speaking, which is what the
    // chat route does too.

    if (agent?.model) {
      return Response.json({
        model: agent.model,
        shared: true,
      });
    }
  }

  const { data: profile } = await db
    .from("profiles")
    .select("default_model")
    .eq("id", user.id)
    .maybeSingle();

  // Nobody has chosen: hand new chats the shared
  // Groq model when the server has a key for it,
  // since it is faster and abler than the machine.
  // With no key the empty answer stands and the
  // local model takes over, exactly as before.

  const fallback = groqKey()
    ? GROQ_DEFAULT_MODEL
    : cerebrasKey()
      ? CEREBRAS_DEFAULT_MODEL
      : "";

  return Response.json({
    model: profile?.default_model || fallback,
    shared: false,
  });
}


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
    model?: string;
    channelId?: string | null;
  };

  const model = (body.model ?? "").trim();

  // In a channel the choice belongs to the
  // channel. Everyone in it gets the same agent,
  // which is the point.

  if (body.channelId) {
    const { error } = await db
      .from("agents")
      .update({ model: model || null })
      .eq("channel_id", body.channelId);

    if (error) {
      return Response.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return Response.json({
      ok: true,
      shared: true,
    });
  }

  const { error } = await db
    .from("profiles")
    .update({ default_model: model || null })
    .eq("id", user.id);

  if (error) {
    if (
      error.code === "42703" ||
      error.code === "PGRST204"
    ) {
      return Response.json(
        {
          error:
            "Run supabase/migrations/0016_shared_keys.sql to save a model choice.",
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

  return Response.json({ ok: true, shared: false });
}
