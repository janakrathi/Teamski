import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Make sure the current user belongs to this DM.
    const { data: membership, error: membershipError } =
      await supabase
        .from("dm_members")
        .select("conversation_id")
        .eq("conversation_id", id)
        .eq("user_id", user.id)
        .maybeSingle();

    if (membershipError) {
      console.error("DM membership check failed:", membershipError);

      return NextResponse.json(
        { error: membershipError.message },
        { status: 500 }
      );
    }

    if (!membership) {
      return NextResponse.json(
        { error: "You are not a member of this conversation" },
        { status: 403 }
      );
    }

    const COLUMNS =
      "id, conversation_id, user_id, content, created_at";

    // edited_at arrives with migration 0014. Ask
    // for it, and fall back rather than failing
    // the whole conversation on a database that
    // is behind.

    type Row = {
      id: string;
      conversation_id: string;
      user_id: string;
      content: string;
      created_at: string;
      edited_at?: string | null;
    };

    let { data: messages, error } = (await supabase
      .from("dm_messages")
      .select(`${COLUMNS}, edited_at`)
      .eq("conversation_id", id)
      .order("created_at", {
        ascending: true,
      })) as {
      data: Row[] | null;
      error: { code?: string; message: string } | null;
    };

    if (
      error &&
      (error.code === "42703" ||
        error.code === "PGRST204")
    ) {
      ({ data: messages, error } = (await supabase
        .from("dm_messages")
        .select(COLUMNS)
        .eq("conversation_id", id)
        .order("created_at", {
          ascending: true,
        })) as {
        data: Row[] | null;
        error: {
          code?: string;
          message: string;
        } | null;
      });
    }

    if (error) {
      console.error("Failed to load DM messages:", error);

      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    // Whatever was posted with these messages.
    // One query for the lot rather than one per
    // message.

    const ids = (messages ?? []).map(
      (message) => message.id
    );

    const { data: files } =
      ids.length > 0
        ? await supabase
            .from("attachments")
            .select(
              "id, dm_message_id, filename, mime, size_bytes, kind, truncated, note"
            )
            .in("dm_message_id", ids)
        : { data: [] };

    const byMessage = new Map<string, unknown[]>();

    for (const file of files ?? []) {
      const key = (file as { dm_message_id: string })
        .dm_message_id;

      byMessage.set(key, [
        ...(byMessage.get(key) ?? []),
        file,
      ]);
    }

    return NextResponse.json({
      messages: (messages ?? []).map((message) => ({
        ...message,

        sender:
          message.user_id === user.id
            ? "you"
            : "teammate",

        attachments:
          byMessage.get(message.id) ?? [],
      })),
    });
  } catch (error) {
    console.error("GET DM messages error:", error);

    return NextResponse.json(
      { error: "Failed to load messages" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Verify membership.
    const { data: membership, error: membershipError } =
      await supabase
        .from("dm_members")
        .select("conversation_id")
        .eq("conversation_id", id)
        .eq("user_id", user.id)
        .maybeSingle();

    if (membershipError) {
      console.error("DM membership check failed:", membershipError);

      return NextResponse.json(
        { error: membershipError.message },
        { status: 500 }
      );
    }

    if (!membership) {
      return NextResponse.json(
        { error: "You are not a member of this conversation" },
        { status: 403 }
      );
    }

    const body = await request.json();

    const content =
      typeof body.content === "string"
        ? body.content.trim()
        : "";

    const attachmentIds = Array.isArray(
      body.attachment_ids
    )
      ? (body.attachment_ids as string[])
      : [];

    // A file on its own is a message. Requiring
    // text to send one would be a strange rule.

    if (!content && attachmentIds.length === 0) {
      return NextResponse.json(
        { error: "Message cannot be empty" },
        { status: 400 }
      );
    }

    const { data: message, error } = await supabase
      .from("dm_messages")
      .insert({
        conversation_id: id,
        user_id: user.id,
        content,
      })
      .select(
        `
        id,
        conversation_id,
        user_id,
        content,
        created_at
        `
      )
      .single();

    if (error) {
      console.error("Failed to create DM message:", error);

      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    // Claim the uploads for this message. Until
    // now they were rows with no message, which
    // is how an upload survives being typed but
    // not sent.

    if (attachmentIds.length > 0) {
      await supabase
        .from("attachments")
        .update({ dm_message_id: message.id })
        .in("id", attachmentIds)
        .eq("conversation_id", id)
        .is("dm_message_id", null);
    }

    return NextResponse.json({
      message: {
        ...message,
        sender: "you",
      },
    });
  } catch (error) {
    console.error("POST DM message error:", error);

    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 }
    );
  }
}


// ==========================================
// CHANGING A MESSAGE
// ==========================================
//
// Only your own, either way - there is no agent
// in a direct message, so there is no second
// rule. Row level security is what enforces it;
// no row back means it was not yours.
//

export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  const { id: conversationId } =
    await context.params;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
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
    return NextResponse.json(
      {
        error:
          "Say which message, and what it should say.",
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("dm_messages")
    .update({
      content,
      edited_at: new Date().toISOString(),
    })
    .eq("id", body.id)
    .eq("conversation_id", conversationId)
    .select("id, content, edited_at")
    .maybeSingle();

  if (error) {
    if (
      error.code === "42703" ||
      error.code === "PGRST204"
    ) {
      return NextResponse.json(
        {
          error:
            "Run supabase/migrations/0014_edit_delete.sql to enable editing.",
          needsMigration: true,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  if (!data) {
    return NextResponse.json(
      {
        error:
          "You can only edit your own messages.",
      },
      { status: 403 }
    );
  }

  return NextResponse.json({ message: data });
}


export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  const { id: conversationId } =
    await context.params;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const messageId =
    request.nextUrl.searchParams.get("id");

  if (!messageId) {
    return NextResponse.json(
      { error: "Say which message." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("dm_messages")
    .delete()
    .eq("id", messageId)
    .eq("conversation_id", conversationId)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  if (!data) {
    return NextResponse.json(
      {
        error:
          "You can only delete your own messages.",
      },
      { status: 403 }
    );
  }

  return NextResponse.json({ ok: true });
}
