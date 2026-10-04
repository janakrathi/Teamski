import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { channelAccess, postRefusal } from "@/lib/plans";

type RouteContext = {
  params: Promise<{ id: string }>;
};


// ==========================================
// START AN AGENT
// ==========================================
//
// This used to make one blocking Ollama call
// inside the request, which meant there was no
// loop to pause, nothing survived a refresh, and
// the agent could not use tools.
//
// It now queues a run. The worker process
// (`npm run worker`) claims it and advances it
// step by step.
//

export async function POST(
  request: Request,
  context: RouteContext
) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { id } = await context.params;

  if (!id) {
    return NextResponse.json(
      { error: "Agent ID is required" },
      { status: 400 }
    );
  }

  let body: { task?: string; channelId?: string };

  try {
    body = await request.json();
  } catch {
    body = {};
  }


  // ----------------------------------------
  // LOAD THE AGENT
  // ----------------------------------------

  const { data: agent, error: agentError } =
    await supabase
      .from("agents")
      .select(
        "id, project_id, name, status, provider, model, current_task"
      )
      .eq("id", id)
      .single();

  if (agentError || !agent) {
    return NextResponse.json(
      { error: "Agent not found" },
      { status: 404 }
    );
  }


  // ----------------------------------------
  // CHECK MEMBERSHIP
  // ----------------------------------------

  // In the project, not a viewer, and able to see the
  // channel the run will post in.

  const channelId =
    typeof body.channelId === "string" &&
    /^[0-9a-f-]{36}$/i.test(body.channelId)
      ? body.channelId
      : null;

  const access = await channelAccess(
    supabase,
    agent.project_id,
    channelId,
    user.id
  );

  if (!access.post) {
    return NextResponse.json(
      { error: postRefusal(access) },
      { status: 403 }
    );
  }


  // ----------------------------------------
  // NO DOUBLE RUNS
  // ----------------------------------------

  const { data: active } = await supabase
    .from("agent_runs")
    .select("id, status")
    .eq("agent_id", agent.id)
    .in("status", ["queued", "running"])
    .maybeSingle();

  if (active) {
    return NextResponse.json(
      {
        error: "This agent is already working.",
        run: active,
      },
      { status: 409 }
    );
  }

  const task =
    typeof body.task === "string" &&
    body.task.trim()
      ? body.task.trim()
      : agent.current_task?.trim() ||
        "Continue working on the current task.";


  // ----------------------------------------
  // QUEUE THE RUN
  // ----------------------------------------

  const { data: run, error: runError } =
    await supabase
      .from("agent_runs")
      .insert({
        agent_id: agent.id,
        project_id: agent.project_id,
        channel_id: channelId,
        started_by: user.id,
        task,
        status: "queued",
      })
      .select("id, status, task, created_at")
      .single();

  if (runError || !run) {
    return NextResponse.json(
      {
        error:
          runError?.message ||
          "Could not queue the run.",

        // The agent_runs migration has not been
        // applied yet.
        needsMigration:
          runError?.code === "42P01" ||
          runError?.code === "PGRST205",
      },
      { status: 500 }
    );
  }

  await supabase
    .from("agents")
    .update({
      status: "working",
      current_task: task,
      updated_at: new Date().toISOString(),
    })
    .eq("id", agent.id);

  return NextResponse.json({
    success: true,
    queued: true,
    run,
  });
}
