import { createClient } from "@/lib/supabase/server";

import { adminClient } from "@/lib/supabase/admin";


// ==========================================
// SERVE A STORED IMAGE, INLINE
// ==========================================
//
// Generated (and attached) images live in the
// private attachments bucket. This serves one by
// its attachment id, with an image content type so
// it renders in a chat message - unlike the file
// download route, which forces a save.
//
// Gated: you must be signed in, and either you
// added it or you are in the project it belongs to.
// The storage read uses the service role because
// the bucket refuses browsers; the check above is
// what keeps it to the right people.
//

const BUCKET = "attachments";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};


export async function GET(
  _request: Request,
  context: RouteContext
) {
  const { id } = await context.params;

  const db = await createClient();

  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    return new Response("Sign in to see this image.", {
      status: 401,
    });
  }

  const admin = adminClient() ?? db;

  const { data: attachment } = await admin
    .from("attachments")
    .select(
      "project_id, uploaded_by, storage_path, mime, kind"
    )
    .eq("id", id)
    .maybeSingle();

  if (
    !attachment ||
    attachment.kind !== "image" ||
    !attachment.storage_path
  ) {
    return new Response("Not found", { status: 404 });
  }

  // You added it, or row-level security lets you see
  // it: in its project, and for a private channel's
  // file, on that channel.
  const yours = attachment.uploaded_by === user.id;

  let allowed = yours;

  if (!allowed) {
    const { data: visible } = await db
      .from("attachments")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    allowed = Boolean(visible);
  }

  if (!allowed) {
    return new Response("Not found", { status: 404 });
  }

  const { data: file, error } = await admin.storage
    .from(BUCKET)
    .download(attachment.storage_path);

  if (error || !file) {
    return new Response("Not found", { status: 404 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  return new Response(bytes, {
    headers: {
      "Content-Type": attachment.mime || "image/png",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
