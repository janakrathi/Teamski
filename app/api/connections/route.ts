import { createClient } from "@/lib/supabase/server";

import { googleCredentials } from "@/lib/connections/google";

import { githubCredentials } from "@/lib/connections/github";

export const dynamic = "force-dynamic";


// ==========================================
// WHAT IS CONNECTED
// ==========================================
//
// Which accounts are linked, and what they may
// do. Never the tokens: those stay on the
// server, and nothing about this response would
// be improved by including them.
//

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
    .from("connections")
    .select(
      "provider, account_email, scopes, created_at"
    )
    .eq("user_id", user.id);

  if (error) {
    // Before migration 0012 there is no table.
    // Say nothing is connected rather than
    // failing the settings panel.

    if (
      error.code === "42P01" ||
      error.code === "PGRST205"
    ) {
      return Response.json({
        connections: [],
        available: [],
        needsMigration: true,
      });
    }

    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }

  // A provider nobody has configured on this
  // server cannot be connected, so the UI should
  // not offer it as though it could.

  const available = [
    googleCredentials() ? "google" : null,
    githubCredentials() ? "github" : null,
  ].filter(Boolean);

  return Response.json({
    connections: data ?? [],
    available,
  });
}


// ==========================================
// DISCONNECTING
// ==========================================
//
// Drops the row, which is the only copy of the
// token this app holds.
//
// It does not revoke the grant at Google's end -
// that is on their account page, and saying so
// is more honest than implying this button
// reaches further than it does.
//

export async function DELETE(request: Request) {
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

  const provider =
    new URL(request.url).searchParams.get(
      "provider"
    ) ?? "google";

  const { error } = await db
    .from("connections")
    .delete()
    .eq("user_id", user.id)
    .eq("provider", provider);

  if (error) {
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return Response.json({ ok: true });
}
