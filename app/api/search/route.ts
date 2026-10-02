import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


// ==========================================
// SEARCH
// ==========================================
//
// Across the messages and channels of one
// project. A workspace nobody can search is a
// workspace where everything said more than a
// day ago is effectively gone.
//

export type SearchHit = {
  kind: "message" | "channel";
  id: string;
  channelId: string | null;
  channelName: string | null;
  role: string | null;
  content: string;
  createdAt: string | null;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const projectId =
    searchParams.get("projectId") || "";

  const query = (searchParams.get("q") || "")
    .trim()
    .slice(0, 200);

  if (!uuidRegex.test(projectId)) {
    return Response.json(
      { error: "A valid projectId is required." },
      { status: 400 }
    );
  }

  if (query.length < 2) {
    return Response.json({ hits: [] });
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

  // ilike needs its wildcards escaped, or a
  // search for "100%" matches everything.

  const pattern = `%${query.replace(
    /[%_\\]/g,
    (character) => `\\${character}`
  )}%`;


  // ----------------------------------------
  // CHANNELS
  // ----------------------------------------

  const channelsResult = await db
    .from("channels")
    .select("id, name, created_at")
    .eq("project_id", projectId)
    .ilike("name", pattern)
    .limit(10);

  const channels = channelsResult.data ?? [];

  const channelNames = new Map(
    channels.map((channel) => [
      channel.id,
      channel.name,
    ])
  );


  // ----------------------------------------
  // MESSAGES
  // ----------------------------------------

  const messagesResult = await db
    .from("messages")
    .select(
      "id, channel_id, role, content, created_at"
    )
    .eq("project_id", projectId)
    .ilike("content", pattern)
    .order("created_at", { ascending: false })
    .limit(50);

  // Without the channels migration there is no
  // channel_id column, so fall back rather than
  // failing the whole search.

  const messages =
    messagesResult.error?.code === "42703"
      ? (
          await db
            .from("messages")
            .select(
              "id, role, content, created_at"
            )
            .eq("project_id", projectId)
            .ilike("content", pattern)
            .order("created_at", {
              ascending: false,
            })
            .limit(50)
        ).data ?? []
      : messagesResult.data ?? [];


  // Name any channel a hit came from, including
  // ones whose name did not match the query.

  const missing = [
    ...new Set(
      messages
        .map(
          (message) =>
            (message as { channel_id?: string })
              .channel_id
        )
        .filter(
          (id): id is string =>
            Boolean(id) && !channelNames.has(id)
        )
    ),
  ];

  if (missing.length > 0) {
    const { data: extra } = await db
      .from("channels")
      .select("id, name")
      .in("id", missing);

    for (const channel of extra ?? []) {
      channelNames.set(channel.id, channel.name);
    }
  }

  const hits: SearchHit[] = [
    ...channels.map((channel) => ({
      kind: "channel" as const,
      id: channel.id,
      channelId: channel.id,
      channelName: channel.name,
      role: null,
      content: `#${channel.name}`,
      createdAt: channel.created_at ?? null,
    })),

    ...messages.map((message) => {
      const channelId =
        (message as { channel_id?: string })
          .channel_id ?? null;

      return {
        kind: "message" as const,
        id: message.id,
        channelId,
        channelName: channelId
          ? channelNames.get(channelId) ?? null
          : null,
        role: message.role,
        content: message.content,
        createdAt: message.created_at,
      };
    }),
  ];

  return Response.json({ hits });
}
