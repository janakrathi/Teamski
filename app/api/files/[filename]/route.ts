import fs from "fs/promises";

import path from "path";

import { createClient } from "@/lib/supabase/server";

import { resolveSafePath } from "@/lib/ai/tools";

export const dynamic = "force-dynamic";


// ==========================================
// DOWNLOADING A FILE AN AGENT MADE
// ==========================================
//
// This used to join whatever name it was given
// onto the server's folder and send the file back,
// to anyone, signed in or not. "..%2F.env.local"
// was enough to download the server's secrets.
//
// Now: you must be signed in, you must be a member
// of the project the file belongs to, and the name
// must resolve inside that project's own folder.
//

export async function GET(
  request: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  const projectId = new URL(request.url).searchParams.get("projectId") ?? "";

  const db = await createClient();

  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    return new Response("Sign in to download files.", { status: 401 });
  }

  let filePath: string;

  try {
    filePath = resolveSafePath(filename, projectId);
  } catch {
    return new Response("File not found", { status: 404 });
  }

  const { data: membership } = await db
    .from("project_members")
    .select("project_id")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return new Response("File not found", { status: 404 });
  }

  try {
    const file = await fs.readFile(filePath);

    // Only the file's own name, and nothing that
    // could break out of the header.
    const name = path.basename(filePath).replace(/["\\\r\n]/g, "_");

    return new Response(file, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new Response("File not found", { status: 404 });
  }
}
