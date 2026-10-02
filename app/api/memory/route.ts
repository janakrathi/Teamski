import { createClient } from "@/lib/supabase/server";

import {
  addFacts,
  clearMemory,
  deleteFact,
  getFacts,
  getSummary,
  type Scope,
} from "@/lib/ai/memory";

export const dynamic = "force-dynamic";

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


// ==========================================
// SCOPE
// ==========================================
//
// Memory belongs to a channel when there is
// one, and to the project otherwise.
//

function scopeFrom(request: Request): Scope | null {
  const { searchParams } = new URL(request.url);

  const projectId =
    searchParams.get("projectId") || "";

  if (!uuidRegex.test(projectId)) {
    return null;
  }

  const channelId =
    searchParams.get("channelId") || "";

  return {
    projectId,
    channelId: uuidRegex.test(channelId)
      ? channelId
      : null,
  };
}


async function authorise() {
  const db = await createClient();

  const {
    data: { user },
  } = await db.auth.getUser();

  return { db, user };
}


// ==========================================
// READ MEMORY
// ==========================================
//
// Everything the agent remembers here, so the
// user can see it and correct it instead of
// guessing.
//

export async function GET(request: Request) {
  const scope = scopeFrom(request);

  if (!scope) {
    return Response.json(
      { error: "A valid projectId is required." },
      { status: 400 }
    );
  }

  const { db, user } = await authorise();

  if (!user) {
    return Response.json(
      { error: "You must be logged in." },
      { status: 401 }
    );
  }

  const [summary, facts] = await Promise.all([
    getSummary(db, scope),
    getFacts(db, scope),
  ]);

  return Response.json({
    summary: summary.summary,
    coveredCount: summary.covered_count,
    facts,
  });
}


// ==========================================
// ADD A FACT BY HAND
// ==========================================

export async function POST(request: Request) {
  const scope = scopeFrom(request);

  if (!scope) {
    return Response.json(
      { error: "A valid projectId is required." },
      { status: 400 }
    );
  }

  const { db, user } = await authorise();

  if (!user) {
    return Response.json(
      { error: "You must be logged in." },
      { status: 401 }
    );
  }

  const body = (await request
    .json()
    .catch(() => ({}))) as { content?: string };

  const content =
    typeof body.content === "string"
      ? body.content.trim()
      : "";

  if (!content) {
    return Response.json(
      { error: "content is required." },
      { status: 400 }
    );
  }

  await addFacts(
    db,
    scope,
    [content],
    "user",
    user.id
  );

  return Response.json({
    facts: await getFacts(db, scope),
  });
}


// ==========================================
// FORGET
// ==========================================
//
// Without an id this wipes the scope's whole
// memory; with one it forgets a single fact.
//

export async function DELETE(request: Request) {
  const scope = scopeFrom(request);

  if (!scope) {
    return Response.json(
      { error: "A valid projectId is required." },
      { status: 400 }
    );
  }

  const { db, user } = await authorise();

  if (!user) {
    return Response.json(
      { error: "You must be logged in." },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);

  const id = searchParams.get("id");

  if (id) {
    await deleteFact(db, scope, id);
  } else {
    await clearMemory(db, scope);
  }

  const [facts, summary] = await Promise.all([
    getFacts(db, scope),
    getSummary(db, scope),
  ]);

  return Response.json({
    facts,
    summary: summary.summary,
  });
}
