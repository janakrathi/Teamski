import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


// ==========================================
// AGENT ACTIVITY
// ==========================================
//
// The current agent for a project, its live run,
// and the steps it has taken. The browser
// subscribes to agent_events for updates; this
// is what it starts from.
//

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const projectId =
    searchParams.get("projectId") || "";

  const channelId =
    searchParams.get("channelId") || "";

  if (!uuidRegex.test(projectId)) {
    return Response.json(
      { error: "A valid projectId is required." },
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

  // The agent that belongs to this channel, so
  // #design and #research answer as themselves.
  // A channel without one falls back to the
  // project's original agent.

  const columns =
    "id, name, description, instructions, status, model, current_task, channel_id";

  let agent = null as Record<
    string,
    unknown
  > | null;

  let agentError = null as {
    code?: string;
    message: string;
  } | null;

  if (uuidRegex.test(channelId)) {
    const owned = await db
      .from("agents")
      .select(columns)
      .eq("channel_id", channelId)
      .maybeSingle();

    agent = owned.data;
    agentError = owned.error;
  }

  if (!agent && !agentError) {
    const fallback = await db
      .from("agents")
      .select(columns)
      .eq("project_id", projectId)
      .is("channel_id", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    agent = fallback.data;
    agentError = fallback.error;
  }

  if (agentError) {
    return Response.json(
      {
        error: agentError.message,

        needsMigration:
          agentError.code === "42501" ||
          agentError.code === "42P01" ||
          agentError.code === "PGRST205",
      },
      { status: 500 }
    );
  }

  if (!agent) {
    return Response.json({
      agent: null,
      run: null,
      events: [],
    });
  }

  // The run in flight, if there is one. A
  // finished run is not interesting here - the
  // events carry its outcome.

  const { data: run, error: runError } = await db
    .from("agent_runs")
    .select("id, status, task, step, created_at")
    .eq("agent_id", agent.id as string)
    .in("status", [
      "queued",
      "running",
      "paused",
    ])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // A denied or missing agent_runs read used to
  // fall through as "no run", which looks exactly
  // like an idle agent. Say so instead.

  if (runError) {
    return Response.json(
      {
        error: runError.message,

        needsMigration:
          runError.code === "42501" ||
          runError.code === "42P01" ||
          runError.code === "PGRST205",
      },
      { status: 500 }
    );
  }

  const { data: events } = await db
    .from("agent_events")
    .select("id, type, message, data, created_at")
    .eq("agent_id", agent.id as string)
    .order("created_at", { ascending: false })
    .limit(40);

  return Response.json({
    agent,
    run: run ?? null,

    // Oldest first, which is how they are read.
    events: (events ?? []).reverse(),
  });
}
