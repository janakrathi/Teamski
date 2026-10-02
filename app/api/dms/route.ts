import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
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

    const { data: memberships, error: membershipError } =
      await supabase
        .from("dm_members")
        .select("conversation_id")
        .eq("user_id", user.id);

    if (membershipError) {
      console.error(
        "Failed to load DM memberships:",
        membershipError
      );

      return NextResponse.json(
        { error: membershipError.message },
        { status: 500 }
      );
    }

    const conversationIds =
      memberships?.map(
        (membership) => membership.conversation_id
      ) ?? [];

    if (conversationIds.length === 0) {
      return NextResponse.json({
        conversations: [],
      });
    }

    const { data: members, error: membersError } =
      await supabase
        .from("dm_members")
        .select(
          `
          conversation_id,
          user_id
          `
        )
        .in("conversation_id", conversationIds)
        .neq("user_id", user.id);

    if (membersError) {
      console.error(
        "Failed to load DM members:",
        membersError
      );

      return NextResponse.json(
        { error: membersError.message },
        { status: 500 }
      );
    }

    const otherUserIds =
      members?.map((member) => member.user_id) ?? [];

    if (otherUserIds.length === 0) {
      return NextResponse.json({
        conversations: [],
      });
    }

    const { data: profiles, error: profilesError } =
      await supabase
        .from("profiles")
        .select(
          `
          id,
          email,
          display_name,
          avatar_url
          `
        )
        .in("id", otherUserIds);

    if (profilesError) {
      console.error(
        "Failed to load DM profiles:",
        profilesError
      );

      return NextResponse.json(
        { error: profilesError.message },
        { status: 500 }
      );
    }

    const profileMap = new Map(
      (profiles ?? []).map((profile) => [
        profile.id,
        profile,
      ])
    );

    const conversations =
      members?.map((member) => ({
        id: member.conversation_id,
        other_user:
          profileMap.get(member.user_id) ?? {
            id: member.user_id,
            email: "Unknown user",
            display_name: null,
            avatar_url: null,
          },
      })) ?? [];

    return NextResponse.json({
      conversations,
    });
  } catch (error) {
    console.error("GET DMs error:", error);

    return NextResponse.json(
      { error: "Failed to load DMs" },
      { status: 500 }
    );
  }
}


export async function POST(
  request: NextRequest
) {
  try {
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

    const body = await request.json();

    const email =
      typeof body.email === "string"
        ? body.email.trim().toLowerCase()
        : "";

    const requestedUserId =
      typeof body.user_id === "string"
        ? body.user_id.trim()
        : "";

    if (!email && !requestedUserId) {
      return NextResponse.json(
        { error: "Email or user ID is required" },
        { status: 400 }
      );
    }

    let otherUserId = requestedUserId;

    // ------------------------------------------
    // Find user by email
    // ------------------------------------------

    if (email) {
      const { data: profile, error: profileError } =
        await supabase
          .from("profiles")
          .select("id")
          .eq("email", email)
          .maybeSingle();

      if (profileError) {
        console.error(
          "Failed to find user:",
          profileError
        );

        return NextResponse.json(
          { error: profileError.message },
          { status: 500 }
        );
      }

      if (!profile) {
        return NextResponse.json(
          { error: "No user found with that email" },
          { status: 404 }
        );
      }

      otherUserId = profile.id;
    }

    if (otherUserId === user.id) {
      return NextResponse.json(
        { error: "You cannot DM yourself" },
        { status: 400 }
      );
    }

    // ------------------------------------------
    // Create / reuse DM through secure function
    // ------------------------------------------

    const { data: conversationId, error: functionError } =
      await supabase.rpc(
        "create_dm_conversation",
        {
          target_user_id: otherUserId,
        }
      );

    if (functionError) {
      console.error(
        "Failed to create DM conversation:",
        functionError
      );

      return NextResponse.json(
        { error: functionError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      conversation: {
        id: conversationId,
      },
    });
  } catch (error) {
    console.error("POST DM error:", error);

    return NextResponse.json(
      { error: "Failed to create DM" },
      { status: 500 }
    );
  }
}