import fs from "node:fs/promises";

import path from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

import { adminClient } from "@/lib/supabase/admin";

import { can, roleInProject } from "@/lib/plans";

import { openSecret } from "@/lib/crypto/secrets";

import { projectFolder } from "@/lib/ai/tools";

export const dynamic = "force-dynamic";


// ==========================================
// EXPORT A PROJECT
// ==========================================
//
// Everything a project holds, in one JSON file, so a
// team can leave with its work: members, channels,
// every message, the agents' memory (decrypted - an
// export nobody can read is not an export), schedules,
// the files agents wrote, and a list of attachments.
//
// Owners and admins only: it is the whole project at
// once, including everyone's email addresses.
//
// Attachments are listed, not included - they can be
// large, and each one downloads from the chat.
//

type RouteContext = {
  params: Promise<{ id: string }>;
};

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_FILES_BYTES = 10 * 1024 * 1024;


// Supabase returns at most 1000 rows a request.

async function everyRow<T>(
  query: (from: number, to: number) => PromiseLike<{
    data: unknown[] | null;
    error: { message: string } | null;
  }>
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; from < 500_000; from += 1000) {
    const { data, error } = await query(from, from + 999);

    if (error || !data) {
      break;
    }

    rows.push(...(data as T[]));

    if (data.length < 1000) {
      break;
    }
  }

  return rows;
}


// The files the project's agents wrote, text included
// up to a limit; anything past it is listed by name.

async function projectFiles(projectId: string) {
  const files: {
    path: string;
    bytes: number;
    content?: string;
    note?: string;
  }[] = [];

  let root: string;

  try {
    root = path.resolve(projectFolder(projectId));
  } catch {
    return files;
  }

  let total = 0;

  async function walk(dir: string) {
    let entries;

    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const stat = await fs.stat(full);
      const relative = path.relative(root, full).split(path.sep).join("/");

      if (stat.size > MAX_FILE_BYTES || total + stat.size > MAX_FILES_BYTES) {
        files.push({
          path: relative,
          bytes: stat.size,
          note: "Too large to include here - download it from the project's files.",
        });

        continue;
      }

      total += stat.size;

      files.push({
        path: relative,
        bytes: stat.size,
        content: await fs.readFile(full, "utf-8"),
      });
    }
  }

  await walk(root);

  return files;
}


export async function GET(request: Request, context: RouteContext) {
  const { id: projectId } = await context.params;

  const session = await createClient();

  const {
    data: { user },
  } = await session.auth.getUser();

  if (!user) {
    return Response.json({ error: "You must be logged in." }, { status: 401 });
  }

  const role = await roleInProject(
    session as unknown as SupabaseClient,
    projectId,
    user.id
  );

  if (!can(role, "manage_settings")) {
    return Response.json(
      { error: "Only the project's owner or an admin can export it." },
      { status: 403 }
    );
  }

  const db = adminClient() as unknown as SupabaseClient | null;

  if (!db) {
    return Response.json(
      { error: "Export is not available on this server." },
      { status: 503 }
    );
  }

  const { data: project } = await db
    .from("projects")
    .select("id, name, created_at")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) {
    return Response.json({ error: "Project not found." }, { status: 404 });
  }

  const [members, channels, messages, facts, summaries, schedules, attachments] =
    await Promise.all([
      everyRow<{ user_id: string; role: string }>((a, b) =>
        db
          .from("project_members")
          .select("user_id, role")
          .eq("project_id", projectId)
          .range(a, b)
      ),
      everyRow<{ id: string; name: string; created_at: string }>((a, b) =>
        db
          .from("channels")
          .select("id, name, created_at")
          .eq("project_id", projectId)
          .order("created_at", { ascending: true })
          .range(a, b)
      ),
      everyRow<{
        channel_id: string | null;
        user_id: string | null;
        role: string;
        content: string;
        created_at: string;
      }>((a, b) =>
        db
          .from("messages")
          .select("channel_id, user_id, role, content, created_at")
          .eq("project_id", projectId)
          .order("created_at", { ascending: true })
          .range(a, b)
      ),
      everyRow<{ channel_id: string | null; content: string; created_at: string }>(
        (a, b) =>
          db
            .from("memory_facts")
            .select("channel_id, content, created_at")
            .eq("project_id", projectId)
            .order("created_at", { ascending: true })
            .range(a, b)
      ),
      everyRow<{ channel_id: string | null; summary: string }>((a, b) =>
        db
          .from("conversation_summaries")
          .select("channel_id, summary")
          .eq("project_id", projectId)
          .range(a, b)
      ),
      everyRow<Record<string, unknown>>((a, b) =>
        db
          .from("agent_schedules")
          .select(
            "channel_id, title, task, cadence, time_of_day, weekday, month_day, timezone, enabled"
          )
          .eq("project_id", projectId)
          .range(a, b)
      ),
      everyRow<{
        channel_id: string | null;
        filename: string;
        mime: string;
        size_bytes: number;
        created_at: string;
      }>((a, b) =>
        db
          .from("attachments")
          .select("channel_id, filename, mime, size_bytes, created_at")
          .eq("project_id", projectId)
          .range(a, b)
      ),
    ]);

  // Names for people and channels, so the export reads
  // like the project rather than a pile of ids.

  const people = new Map<string, { name: string | null; email: string | null }>();

  const ids = [
    ...new Set([
      ...members.map((row) => row.user_id),
      ...messages.map((row) => row.user_id).filter((id): id is string => Boolean(id)),
    ]),
  ];

  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db
      .from("profiles")
      .select("id, display_name, email")
      .in("id", ids.slice(i, i + 200));

    for (const row of data ?? []) {
      people.set(row.id as string, {
        name: (row.display_name as string | null) ?? null,
        email: (row.email as string | null) ?? null,
      });
    }
  }

  const channelName = new Map(channels.map((row) => [row.id, row.name]));

  const who = (userId: string | null, messageRole: string) => {
    if (!userId || messageRole === "assistant") {
      return "Agent";
    }

    const person = people.get(userId);

    return person?.name || person?.email || "Former member";
  };

  const where = (channelId: string | null) =>
    (channelId && channelName.get(channelId)) || null;

  const exported = {
    format: "teamski-project-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    exportedBy: user.email ?? null,

    project: {
      name: project.name,
      createdAt: project.created_at,
    },

    members: members.map((row) => ({
      name: people.get(row.user_id)?.name ?? null,
      email: people.get(row.user_id)?.email ?? null,
      role: row.role,
    })),

    channels: channels.map((channel) => ({
      name: channel.name,
      createdAt: channel.created_at,

      messages: messages
        .filter((message) => message.channel_id === channel.id)
        .map((message) => ({
          from: who(message.user_id, message.role),
          at: message.created_at,
          text: message.content,
        })),

      agentMemory: {
        summary:
          openSecret(
            summaries.find((row) => row.channel_id === channel.id)?.summary
          ) ?? null,

        facts: facts
          .filter((row) => row.channel_id === channel.id)
          .map((row) => openSecret(row.content))
          .filter((fact): fact is string => Boolean(fact)),
      },
    })),

    // Memory kept for the project as a whole rather
    // than one channel.
    projectMemory: facts
      .filter((row) => !row.channel_id)
      .map((row) => openSecret(row.content))
      .filter((fact): fact is string => Boolean(fact)),

    schedules: schedules.map((row) => ({
      ...row,
      channel_id: undefined,
      channel: where(row.channel_id as string | null),
    })),

    files: await projectFiles(projectId),

    attachments: attachments.map((row) => ({
      filename: row.filename,
      type: row.mime,
      bytes: row.size_bytes,
      channel: where(row.channel_id),
      uploadedAt: row.created_at,
    })),
  };

  const slug =
    String(project.name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "project";

  const day = new Date().toISOString().slice(0, 10);

  return new Response(JSON.stringify(exported, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="teamski-${slug}-${day}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
