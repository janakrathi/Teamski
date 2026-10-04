import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type ControlAction = "pause" | "resume" | "stop" | "redirect";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(
  request: Request,
  context: RouteContext
) {
  const supabase = await createClient();

  // --------------------------------------------------
  // 1. Authenticate user
  // --------------------------------------------------

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

  // --------------------------------------------------
  // 2. Get agent ID
  // --------------------------------------------------

  const { id } = await context.params;

  if (!id) {
    return NextResponse.json(
      { error: "Agent ID is required" },
      { status: 400 }
    );
  }

  // --------------------------------------------------
  // 3. Read requested action
  // --------------------------------------------------

  let body: {
    action?: ControlAction;
    task?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const action = body.action;

  if (
    action !== "pause" &&
    action !== "resume" &&
    action !== "stop" &&
    action !== "redirect"
  ) {
    return NextResponse.json(
      {
        error:
          "Invalid action. Use pause, resume, stop, or redirect.",
      },
      { status: 400 }
    );
  }

  // --------------------------------------------------
  // 4. Load agent
  // --------------------------------------------------

  const { data: agent, error: agentError } = await supabase
    .from("agents")
    .select(
      "id, project_id, name, status, current_task"
    )
    .eq("id", id)
    .single();

  if (agentError || !agent) {
    return NextResponse.json(
      { error: "Agent not found" },
      { status: 404 }
    );
  }

  // --------------------------------------------------
  // 5. Make sure user belongs to the project
  // --------------------------------------------------

  const { data: membership, error: membershipError } =
    await supabase
      .from("project_members")
      .select("project_id, user_id, role")
      .eq("project_id", agent.project_id)
      .eq("user_id", user.id)
      .maybeSingle();

  if (membershipError || !membership) {
    return NextResponse.json(
      { error: "You are not a member of this project" },
      { status: 403 }
    );
  }

  if (membership.role === "viewer") {
    return NextResponse.json(
      { error: "Viewers can watch agents but not steer them." },
      { status: 403 }
    );
  }

  // --------------------------------------------------
  // 6. Determine new state
  // --------------------------------------------------

  let newStatus: string;
  let eventType:
    | "paused"
    | "resumed"
    | "stopped"
    | "redirected";
  let eventMessage: string;

  switch (action) {
    case "pause":
      if (agent.status !== "working") {
        return NextResponse.json(
          {
            error: `Agent cannot be paused while status is "${agent.status}".`,
          },
          { status: 409 }
        );
      }

      newStatus = "paused";
      eventType = "paused";
      eventMessage = `${agent.name} was paused by a teammate.`;
      break;

    case "resume":
      if (agent.status !== "paused") {
        return NextResponse.json(
          {
            error: `Agent cannot be resumed while status is "${agent.status}".`,
          },
          { status: 409 }
        );
      }

      newStatus = "working";
      eventType = "resumed";
      eventMessage = `${agent.name} was resumed by a teammate.`;
      break;

    case "stop":
      if (
        agent.status !== "working" &&
        agent.status !== "paused"
      ) {
        return NextResponse.json(
          {
            error: `Agent cannot be stopped while status is "${agent.status}".`,
          },
          { status: 409 }
        );
      }

      newStatus = "stopped";
      eventType = "stopped";
      eventMessage = `${agent.name} was stopped by a teammate.`;
      break;

    case "redirect":
      if (agent.status !== "working") {
        return NextResponse.json(
          {
            error: `Agent cannot be redirected while status is "${agent.status}".`,
          },
          { status: 409 }
        );
      }

      if (
        !body.task ||
        typeof body.task !== "string" ||
        !body.task.trim()
      ) {
        return NextResponse.json(
          {
            error:
              "A task is required when redirecting the agent.",
          },
          { status: 400 }
        );
      }

      newStatus = "working";
      eventType = "redirected";
      eventMessage = `${agent.name} was redirected by a teammate.`;
      break;
  }

  // --------------------------------------------------
  // 7. Update agent
  // --------------------------------------------------

  const updateData: {
    status: string;
    current_task?: string | null;
    updated_at: string;
  } = {
    status: newStatus,
    updated_at: new Date().toISOString(),
  };

  if (action === "redirect") {
    updateData.current_task = body.task!.trim();
  }

  if (action === "stop") {
    updateData.current_task = null;
  }

  const { data: updatedAgent, error: updateError } =
    await supabase
      .from("agents")
      .update(updateData)
      .eq("id", agent.id)
      .select(
        "id, project_id, name, description, status, provider, model, current_task, config, created_by, created_at, updated_at"
      )
      .single();

  // --------------------------------------------------
  // 7b. Tell the running job
  // --------------------------------------------------
  //
  // The worker reads the run's status between
  // steps, so this is what actually interrupts
  // the work rather than only relabelling the
  // agent in the UI.

  const runStatus =
    action === "pause"
      ? "paused"
      : action === "stop"
        ? "stopped"
        : action === "resume"
          ? "queued"
          : null;

  if (runStatus) {
    const { error: runError } = await supabase
      .from("agent_runs")
      .update({
        status: runStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("agent_id", agent.id)
      .in(
        "status",
        action === "resume"
          ? ["paused"]
          : ["queued", "running"]
      );

    if (runError) {
      console.error(
        "Failed to signal the run:",
        runError.message
      );
    }
  }

  if (updateError || !updatedAgent) {
    console.error(
      "Failed to update agent:",
      updateError
    );

    return NextResponse.json(
      {
        error: "Failed to update agent",
        details: updateError?.message,
      },
      { status: 500 }
    );
  }

  // --------------------------------------------------
  // 8. Create event
  // --------------------------------------------------

  const { data: event, error: eventError } =
    await supabase
      .from("agent_events")
      .insert({
        agent_id: agent.id,
        project_id: agent.project_id,
        actor_id: user.id,
        type: eventType,
        message: eventMessage,
        data:
          action === "redirect"
            ? {
                task: body.task!.trim(),
              }
            : {},
      })
      .select()
      .single();

  if (eventError) {
    console.error(
      `Failed to create ${eventType} event:`,
      eventError
    );

    return NextResponse.json(
      {
        success: true,
        agent: updatedAgent,
        warning:
          "Agent state changed, but the event could not be recorded.",
      },
      { status: 200 }
    );
  }

  // --------------------------------------------------
  // 9. Return result
  // --------------------------------------------------

  return NextResponse.json({
    success: true,
    agent: updatedAgent,
    event,
  });
}