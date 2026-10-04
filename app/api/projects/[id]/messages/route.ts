import { forgetMessage } from "@/lib/ai/memory";

import { createClient } from "@/lib/supabase/server";

import { channelAccess, postRefusal } from "@/lib/plans";

import {
  displayName,
  findMentioned,
} from "@/lib/mentions";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


// A message row as the client sees it. channel_id
// is optional because the channels migration may
// not have been applied yet.

type MessageRow = {
  edited_at?: string | null;
  id: string;
  project_id: string;
  channel_id?: string | null;
  user_id: string | null;
  role: string;
  content: string;
  file: string | null;
  created_at: string;

  // The message this one answers (0032). Absent on a
  // database that has not run the migration yet.
  reply_to?: string | null;

  // The model that wrote an agent reply (0036).
  model?: string | null;
};

type QueryError = {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
};


// Postgres reports an unknown column as 42703,
// while PostgREST reports it as PGRST204 when the
// column is missing from its schema cache. Either
// means the channels migration has not been run.

function isMissingColumn(
  error: QueryError | null
) {
  return (
    error?.code === "42703" ||
    error?.code === "PGRST204"
  );
}


// ============================================
// GET MESSAGES
// ============================================

export async function GET(
  request: Request,
  context: RouteContext
) {
  try {
    const { id: projectId } =
      await context.params;

    const supabase =
      await createClient();

    // ------------------------------------------
    // CHECK AUTHENTICATION
    // ------------------------------------------

    const {
      data: { user },
      error: userError,
    } =
      await supabase.auth.getUser();

    if (userError || !user) {
      return Response.json(
        {
          error:
            "You must be logged in.",
        },
        {
          status: 401,
        }
      );
    }

    // ------------------------------------------
    // CHECK PROJECT ID
    // ------------------------------------------

    if (!uuidRegex.test(projectId)) {
      return Response.json(
        {
          error:
            "Invalid project ID.",
        },
        {
          status: 400,
        }
      );
    }

    // ------------------------------------------
    // LOAD MESSAGES
    // ------------------------------------------
    //
    // A channel narrows the thread. Without one
    // we return the whole project, which is what
    // conversations created before channels
    // existed still look like.
    //

    const channelId =
      new URL(request.url).searchParams.get(
        "channelId"
      ) || "";

    // The channels migration may not have been
    // run yet, in which case messages has no
    // channel_id column. Ask for it, and fall
    // back to the pre-channels shape rather than
    // failing the whole conversation.

    const load = (columns: string) => {
      let query = supabase
        .from("messages")
        .select(columns)
        .eq("project_id", projectId);

      if (uuidRegex.test(channelId)) {
        query = query.eq("channel_id", channelId);
      }

      return query.order("created_at", {
        ascending: true,
      }) as unknown as Promise<{
        data: MessageRow[] | null;
        error: QueryError | null;
      }>;
    };

    // reply_to (0032) is newest, then edited_at, then
    // channel_id - fall back a tier at a time so an
    // un-migrated database still loads the conversation.
    let result = await load(
      "id, project_id, channel_id, user_id, role, content, file, created_at, edited_at, reply_to, model"
    );

    if (isMissingColumn(result.error)) {
      result = await load(
        "id, project_id, channel_id, user_id, role, content, file, created_at, edited_at, reply_to"
      );
    }

    if (isMissingColumn(result.error)) {
      result = await load(
        "id, project_id, channel_id, user_id, role, content, file, created_at, edited_at"
      );
    }

    if (isMissingColumn(result.error)) {
      result = (await supabase
        .from("messages")
        .select(
          "id, project_id, user_id, role, content, file, created_at"
        )
        .eq("project_id", projectId)
        .order("created_at", {
          ascending: true,
        })) as {
        data: MessageRow[] | null;
        error: QueryError | null;
      };
    }

    const messages = result.data;
    const error = result.error;

    if (error) {
      console.error(
        "Failed to load messages:",
        error
      );

      return Response.json(
        {
          error:
            "Failed to load messages.",
          details:
            error.message,
        },
        {
          status: 500,
        }
      );
    }

    // ------------------------------------------
    // ADD UI SENDER
    // ------------------------------------------
    //
    // The database stores the real user_id.
    // The frontend gets a simple sender label.
    //

    // Files people attached to these messages.
    // Fetched in one go rather than per message,
    // and tolerated if the table is not there yet.

    const messageIds = (messages ?? []).map(
      (msg) => msg.id
    );

    const attachmentsByMessage = new Map<
      string,
      unknown[]
    >();

    if (messageIds.length > 0) {
      const { data: files } = await supabase
        .from("attachments")
        .select(
          "id, message_id, filename, mime, size_bytes, kind, truncated, note"
        )
        .in("message_id", messageIds);

      for (const file of files ?? []) {
        const list =
          attachmentsByMessage.get(
            file.message_id
          ) ?? [];

        list.push(file);

        attachmentsByMessage.set(
          file.message_id,
          list
        );
      }
    }

    // Who wrote each message. A teammate is a
    // person, so show their name rather than the
    // word "teammate".

    const authorIds = [
      ...new Set(
        (messages ?? [])
          .map((msg) => msg.user_id)
          .filter(
            (id): id is string =>
              Boolean(id) && id !== user.id
          )
      ),
    ];

    const namesById = new Map<string, string>();

    if (authorIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name, email")
        .in("id", authorIds);

      for (const profile of profiles ?? []) {
        namesById.set(
          profile.id,
          profile.display_name ||
            profile.email ||
            "Teammate"
        );
      }
    }

    const formattedMessages =
      (messages ?? []).map(
        (msg) => {
          let sender:
            | "you"
            | "teammate"
            | "agent";

          if (
            msg.role ===
            "assistant"
          ) {
            sender = "agent";
          } else if (
            msg.user_id ===
            user.id
          ) {
            sender = "you";
          } else {
            sender = "teammate";
          }

          return {
            ...msg,
            sender,
            sender_name:
              sender === "teammate"
                ? namesById.get(
                    msg.user_id ?? ""
                  ) ?? "Teammate"
                : null,
            attachments:
              attachmentsByMessage.get(msg.id) ??
              [],
          };
        }
      );

    return Response.json({
      messages:
        formattedMessages,
    });
  } catch (error) {
    console.error(
      "Messages GET error:",
      error
    );

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load messages.",
      },
      {
        status: 500,
      }
    );
  }
}


// ============================================
// POST MESSAGE
// ============================================

export async function POST(
  request: Request,
  context: RouteContext
) {
  try {
    const { id: projectId } =
      await context.params;

    const supabase =
      await createClient();

    // ------------------------------------------
    // CHECK AUTHENTICATION
    // ------------------------------------------

    const {
      data: { user },
      error: userError,
    } =
      await supabase.auth.getUser();

    if (userError || !user) {
      return Response.json(
        {
          error:
            "You must be logged in.",
        },
        {
          status: 401,
        }
      );
    }

    // ------------------------------------------
    // CHECK PROJECT ID
    // ------------------------------------------

    if (!uuidRegex.test(projectId)) {
      return Response.json(
        {
          error:
            "Invalid project ID.",
        },
        {
          status: 400,
        }
      );
    }

    // ------------------------------------------
    // READ REQUEST
    // ------------------------------------------

    const body =
      await request.json();

    // Only people post through this route. The
    // agent's own replies are saved by the server
    // that generates them (app/api/chat), with the
    // service role, so a forged "Agent" message
    // cannot be posted here or straight to the
    // database.
    const role = body.role === "user" ? "user" : null;

    const content =
      typeof body.content ===
      "string"
        ? body.content
        : "";

    const file =
      typeof body.file ===
      "string"
        ? body.file
        : null;

    const channelId =
      typeof body.channel_id === "string" &&
      uuidRegex.test(body.channel_id)
        ? body.channel_id
        : null;

    // Files uploaded before the message existed.
    // Claiming them here is what stops them being
    // orphaned the moment the message is sent.

    const attachmentIds: string[] = Array.isArray(
      body.attachment_ids
    )
      ? body.attachment_ids.filter(
          (id: unknown): id is string =>
            typeof id === "string" &&
            uuidRegex.test(id)
        )
      : [];

    if (!role) {
      return Response.json(
        {
          error:
            "Invalid message role.",
        },
        {
          status: 400,
        }
      );
    }

    if (!content.trim()) {
      return Response.json(
        {
          error:
            "Message content is required.",
        },
        {
          status: 400,
        }
      );
    }

    // A viewer reads; a private channel is for the
    // people on it. The database refuses either way -
    // this says why in words.

    const access = await channelAccess(
      supabase,
      projectId,
      channelId,
      user.id
    );

    if (!access.post) {
      return Response.json(
        { error: postRefusal(access) },
        { status: 403 }
      );
    }

    // ------------------------------------------
    // SAVE MESSAGE
    // ------------------------------------------
    //
    // IMPORTANT:
    // We DO NOT trust sender from the browser.
    //
    // For human messages:
    // user_id = authenticated user
    //
    // For agent messages:
    // user_id = null
    //

    // As with the read above, tolerate a
    // database that has not had the channels
    // migration applied yet.

    const authorId = user.id;

    let saved = (await supabase
      .from("messages")
      .insert({
        project_id: projectId,
        channel_id: channelId,
        user_id: authorId,
        role,
        content,
        file,
      })
      .select(
        "id, project_id, channel_id, user_id, role, content, file, created_at"
      )
      .single()) as {
      data: MessageRow | null;
      error: QueryError | null;
    };

    if (isMissingColumn(saved.error)) {
      saved = (await supabase
        .from("messages")
        .insert({
          project_id: projectId,
          user_id: authorId,
          role,
          content,
          file,
        })
        .select(
          "id, project_id, user_id, role, content, file, created_at"
        )
        .single()) as {
        data: MessageRow | null;
        error: QueryError | null;
      };
    }

    const message = saved.data;
    const error = saved.error;

    if (
      error ||
      !message
    ) {
      console.error(
        "Failed to save message:",
        error
      );

      return Response.json(
        {
          error:
            error?.message ||
            "Failed to save message.",
          details:
            error?.details,
          hint:
            error?.hint,
          code:
            error?.code,
        },
        {
          status: 500,
        }
      );
    }

    // ------------------------------------------
    // CLAIM ATTACHMENTS
    // ------------------------------------------

    let attachments: unknown[] = [];

    if (attachmentIds.length > 0) {
      const { data: linked, error: linkError } =
        await supabase
          .from("attachments")
          .update({ message_id: message.id })
          .in("id", attachmentIds)
          .eq("project_id", projectId)
          .select(
            "id, filename, mime, size_bytes, kind, truncated, note"
          );

      if (linkError) {
        console.error(
          "Could not link attachments:",
          linkError.message
        );
      }

      attachments = linked ?? [];
    }


    // ------------------------------------------
    // NOTIFY ANYONE MENTIONED
    // ------------------------------------------
    //
    // Best effort: a mention that fails to notify
    // should not fail the message that carried it.

    if (role === "user" && content.includes("@")) {
      try {
        const { data: memberships } =
          await supabase
            .from("project_members")
            .select("user_id")
            .eq("project_id", projectId);

        const otherIds = (memberships ?? [])
          .map((row) => row.user_id)
          .filter((id) => id !== user.id);

        if (otherIds.length > 0) {
          const { data: profiles } =
            await supabase
              .from("profiles")
              .select("id, email, display_name")
              .in("id", otherIds);

          const mentioned = findMentioned(
            content,
            profiles ?? []
          );

          if (mentioned.length > 0) {
            const { data: me } = await supabase
              .from("profiles")
              .select("id, email, display_name")
              .eq("id", user.id)
              .maybeSingle();

            const from = me
              ? displayName(me)
              : "A teammate";

            await supabase
              .from("notifications")
              .insert(
                mentioned.map((id) => ({
                  user_id: id,
                  project_id: projectId,
                  channel_id: channelId,
                  message_id: message.id,
                  actor_id: user.id,
                  kind: "mention",
                  title: `${from} mentioned you`,
                  body: content.slice(0, 300),
                }))
              );
          }
        }
      } catch (error) {
        console.error(
          "Could not send mention notifications:",
          error
        );
      }
    }


    // ------------------------------------------
    // RETURN MESSAGE
    // ------------------------------------------

    return Response.json({
      message: {
        ...message,
        attachments,
        sender: "you",
      },
    });
  } catch (error) {
    console.error(
      "Messages POST error:",
      error
    );

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to save message.",
      },
      {
        status: 500,
      }
    );
  }
}


// ==========================================
// CHANGING A MESSAGE
// ==========================================
//
// Row level security decides who may: your own,
// and for deleting, the agent's too. These
// handlers only shape the request and report
// what happened - if a policy refuses, no rows
// come back and that is the answer.
//

export async function PATCH(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json(
      { error: "You must be logged in." },
      { status: 401 }
    );
  }

  const body = (await request
    .json()
    .catch(() => ({}))) as {
    id?: string;
    content?: string;
  };

  const content = (body.content ?? "").trim();

  if (!body.id || !content) {
    return Response.json(
      {
        error:
          "Say which message, and what it should say.",
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("messages")
    .update({
      content,
      edited_at: new Date().toISOString(),
    })
    .eq("id", body.id)
    .select(
      "id, role, project_id, channel_id, content, created_at, edited_at"
    )
    .maybeSingle();

  if (error) {
    // The column arrives with migration 0014.

    if (
      error.code === "42703" ||
      error.code === "PGRST204"
    ) {
      return Response.json(
        {
          error:
            "Run supabase/migrations/0014_edit_delete.sql to enable editing.",
          needsMigration: true,
        },
        { status: 400 }
      );
    }

    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }

  // No row means a policy refused, which for an
  // edit means it was not yours.

  if (!data) {
    return Response.json(
      {
        error:
          "You can only edit your own messages.",
      },
      { status: 403 }
    );
  }

  // What the old wording taught the agent no
  // longer holds.

  await forgetMessage(supabase, data);

  return Response.json({
    message: {
      id: data.id,
      content: data.content,
      edited_at: data.edited_at,
    },
  });
}


export async function DELETE(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json(
      { error: "You must be logged in." },
      { status: 401 }
    );
  }

  const id = new URL(
    request.url
  ).searchParams.get("id");

  if (!id) {
    return Response.json(
      { error: "Say which message." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("messages")
    .delete()
    .eq("id", id)
    .select("id, role, project_id, channel_id, created_at")
    .maybeSingle();

  if (error) {
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }

  if (!data) {
    return Response.json(
      {
        error:
          "You can only delete your own messages, or the agent's.",
      },
      { status: 403 }
    );
  }

  // A deleted message should not live on in
  // what the agent remembers.

  await forgetMessage(supabase, data);

  return Response.json({ ok: true });
}
