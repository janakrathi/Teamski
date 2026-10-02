import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};


export async function GET(
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
      { error: "Not authenticated" },
      { status: 401 }
    );
  }

  const { id } = await context.params;

  const { data, error } = await supabase
    .from("agents")
    .select(
      `
      id,
      project_id,
      name,
      description,
      status,
      provider,
      model,
      current_task,
      config,
      created_by,
      created_at,
      updated_at
      `
    )
    .eq("id", id)
    .single();

  if (error) {
    console.error("GET /api/agents/[id] error:", error);

    return NextResponse.json(
      { error: "Agent not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    agent: data,
  });
}


export async function PATCH(
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
      { error: "Not authenticated" },
      { status: 401 }
    );
  }

  const { id } = await context.params;

  let body: {
    name?: string;
    description?: string | null;
    status?: string;
    provider?: string;
    model?: string;
    current_task?: string | null;
    config?: Record<string, unknown>;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const allowedStatuses = [
    "idle",
    "working",
    "paused",
    "stopped",
    "waiting_approval",
    "error",
  ];

  if (
    body.status !== undefined &&
    !allowedStatuses.includes(body.status)
  ) {
    return NextResponse.json(
      { error: "Invalid agent status" },
      { status: 400 }
    );
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (body.name !== undefined) {
    if (
      typeof body.name !== "string" ||
      !body.name.trim()
    ) {
      return NextResponse.json(
        { error: "name must be a non-empty string" },
        { status: 400 }
      );
    }

    updates.name = body.name.trim();
  }

  if (body.description !== undefined) {
    updates.description =
      typeof body.description === "string"
        ? body.description.trim() || null
        : null;
  }

  if (body.status !== undefined) {
    updates.status = body.status;
  }

  if (body.provider !== undefined) {
    updates.provider = body.provider;
  }

  if (body.model !== undefined) {
    updates.model = body.model;
  }

  if (body.current_task !== undefined) {
    updates.current_task = body.current_task;
  }

  if (body.config !== undefined) {
    updates.config = body.config;
  }

  const { data, error } = await supabase
    .from("agents")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("PATCH /api/agents/[id] error:", error);

    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    agent: data,
  });
}


export async function DELETE(
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
      { error: "Not authenticated" },
      { status: 401 }
    );
  }

  const { id } = await context.params;

  const { error } = await supabase
    .from("agents")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("DELETE /api/agents/[id] error:", error);

    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
  });
}