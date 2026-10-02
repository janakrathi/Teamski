import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
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

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("project_id");

  if (!projectId) {
    return NextResponse.json(
      { error: "project_id is required" },
      { status: 400 }
    );
  }

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
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("GET /api/agents error:", error);

    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    agents: data ?? [],
  });
}


export async function POST(request: Request) {
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

  let body: {
    project_id?: string;
    name?: string;
    description?: string;
    provider?: string;
    model?: string;
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

  if (!body.project_id) {
    return NextResponse.json(
      { error: "project_id is required" },
      { status: 400 }
    );
  }

  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim()
      : "Agent";

  const description =
    typeof body.description === "string"
      ? body.description.trim() || null
      : null;

  const provider =
    typeof body.provider === "string" && body.provider.trim()
      ? body.provider.trim()
      : "ollama";

  const model =
    typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : "qwen3:4b";

  const config =
    body.config && typeof body.config === "object"
      ? body.config
      : {};

  const { data, error } = await supabase
    .from("agents")
    .insert({
      project_id: body.project_id,
      name,
      description,
      provider,
      model,
      config,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) {
    console.error("POST /api/agents error:", error);

    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      agent: data,
    },
    { status: 201 }
  );
}