import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";


// ==========================================
// NOTIFICATIONS
// ==========================================
//
// Only ever your own: row level security scopes
// every read and write to the signed in user.
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
    .from("notifications")
    .select(
      "id, kind, title, body, project_id, channel_id, message_id, read_at, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    return Response.json(
      {
        error: error.message,

        needsMigration:
          error.code === "42P01" ||
          error.code === "PGRST205" ||
          error.code === "42501",
      },
      { status: 500 }
    );
  }

  const notifications = data ?? [];

  return Response.json({
    notifications,

    unread: notifications.filter(
      (item) => !item.read_at
    ).length,
  });
}


// ==========================================
// MARK READ
// ==========================================
//
// With an id, one of them. Without, all of them.
//

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
    .catch(() => ({}))) as { id?: string };

  let query = db
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null);

  if (body.id) {
    query = query.eq("id", body.id);
  }

  const { error } = await query;

  if (error) {
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return Response.json({ ok: true });
}
