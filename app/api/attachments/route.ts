import { createClient } from "@/lib/supabase/server";

import { channelAccess, postRefusal } from "@/lib/plans";

import {
  MAX_UPLOAD_BYTES,
  extractText,
} from "@/lib/attachments/extract";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const BUCKET = "attachments";


// A filename from a browser is untrusted: it can
// carry path separators, and it becomes part of a
// storage key.

function safeName(raw: string) {
  return (
    raw
      .split(/[\\/]/)
      .pop()!
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 120) || "file"
  );
}


// ==========================================
// UPLOAD
// ==========================================

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

  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: "Expected a file upload." },
      { status: 400 }
    );
  }

  const projectId = String(
    form.get("projectId") ?? ""
  );

  const channelId = String(
    form.get("channelId") ?? ""
  );

  // A file belongs to a channel or to a direct
  // message, never both. The row has a check
  // constraint saying the same thing; this is so
  // the caller gets a sentence rather than a
  // constraint violation.

  const conversationId = String(
    form.get("conversationId") ?? ""
  );

  const inDM = uuidRegex.test(conversationId);

  if (!inDM && !uuidRegex.test(projectId)) {
    return Response.json(
      {
        error:
          "A valid projectId or conversationId is required.",
      },
      { status: 400 }
    );
  }

  // Viewers do not upload, and a private channel's
  // files are for the people on it.

  if (!inDM) {
    const access = await channelAccess(
      db,
      projectId,
      uuidRegex.test(channelId) ? channelId : null,
      user.id
    );

    if (!access.post) {
      return Response.json(
        { error: postRefusal(access) },
        { status: 403 }
      );
    }
  }

  const file = form.get("file");

  if (!(file instanceof File)) {
    return Response.json(
      { error: "No file was sent." },
      { status: 400 }
    );
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json(
      {
        error: `${file.name} is larger than the ${
          MAX_UPLOAD_BYTES / 1024 / 1024
        }MB limit.`,
      },
      { status: 413 }
    );
  }

  if (file.size === 0) {
    return Response.json(
      { error: `${file.name} is empty.` },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(
    await file.arrayBuffer()
  );

  const filename = safeName(file.name);

  // The first path segment is the project, which
  // is what the storage policies check.

  // Storage is laid out by whatever the file
  // belongs to, so a DM's files are not scattered
  // through some project's folder.

  const storagePath = `${
    inDM ? `dm/${conversationId}` : projectId
  }/${crypto.randomUUID()}-${filename}`;

  const upload = await db.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (upload.error) {
    console.error(
      "Attachment upload failed:",
      upload.error
    );

    return Response.json(
      {
        error: upload.error.message,

        // The bucket is created by the migration.
        needsMigration:
          /bucket/i.test(upload.error.message),
      },
      { status: 500 }
    );
  }

  // Parse once, here, rather than on every turn
  // that mentions the file.

  const extraction = await extractText(
    buffer,
    filename,
    file.type || ""
  );

  const { data: row, error } = await db
    .from("attachments")
    .insert({
      project_id: inDM ? null : projectId,
      conversation_id: inDM ? conversationId : null,
      channel_id:
        !inDM && uuidRegex.test(channelId)
          ? channelId
        : null,
      uploaded_by: user.id,
      filename,
      mime: file.type || "",
      size_bytes: file.size,
      storage_path: storagePath,
      kind: extraction.kind,
      extracted_text: extraction.text,
      truncated: extraction.truncated,
      note: extraction.note ?? null,
    })
    .select(
      "id, filename, mime, size_bytes, kind, truncated, note, created_at"
    )
    .single();

  if (error || !row) {
    // Do not leave the bytes behind if the row
    // could not be written.

    await db.storage
      .from(BUCKET)
      .remove([storagePath]);

    return Response.json(
      {
        error:
          error?.message ??
          "Could not save the attachment.",

        needsMigration:
          error?.code === "42P01" ||
          error?.code === "PGRST205" ||
          error?.code === "42501",
      },
      { status: 500 }
    );
  }

  return Response.json({ attachment: row });
}


// ==========================================
// DOWNLOAD LINK
// ==========================================
//
// The bucket is private, so hand back a signed
// URL rather than a path.
//

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const id = searchParams.get("id") || "";

  if (!uuidRegex.test(id)) {
    return Response.json(
      { error: "A valid id is required." },
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

  // Row level security already limits this to
  // the projects the user belongs to.

  const { data: attachment } = await db
    .from("attachments")
    .select("storage_path, filename")
    .eq("id", id)
    .maybeSingle();

  if (!attachment) {
    return Response.json(
      { error: "Not found." },
      { status: 404 }
    );
  }

  const { data: signed, error } = await db.storage
    .from(BUCKET)
    .createSignedUrl(
      attachment.storage_path,
      60 * 10
    );

  if (error || !signed) {
    return Response.json(
      {
        error:
          error?.message ??
          "Could not create a link.",
      },
      { status: 500 }
    );
  }

  return Response.json({
    url: signed.signedUrl,
    filename: attachment.filename,
  });
}
