import { sendEmail } from "@/lib/email/send";

import { projectInviteEmail } from "@/lib/email/templates";

import { createClient } from "@/lib/supabase/server";

import { adminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";

import {
  TEAM_MAX_MEMBERS,
  can,
  projectPlan,
  type ProjectRole,
} from "@/lib/plans";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


// ==========================================
// PROJECT MEMBERS
// ==========================================
//
// The people you can DM inside a project. The
// current user is left out - the sidebar lists
// teammates, not yourself.
//

export async function GET(
  request: Request,
  context: RouteContext
) {
  const { id: projectId } = await context.params;

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

  if (!uuidRegex.test(projectId)) {
    return Response.json(
      { error: "Invalid project ID." },
      { status: 400 }
    );
  }

  const { data: memberships, error } =
    await supabase
      .from("project_members")
      .select("user_id, role")
      .eq("project_id", projectId);

  if (error) {
    console.error(
      "Failed to load project members:",
      error
    );

    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }

  // The sidebar lists people to message, so it
  // leaves you out. The people list is a roster,
  // so it does not.

  const includeSelf =
    new URL(request.url).searchParams.get(
      "includeSelf"
    ) === "true";

  const otherIds = (memberships ?? [])
    .map((membership) => membership.user_id)
    .filter(
      (id) => includeSelf || id !== user.id
    );

  if (otherIds.length === 0) {
    return Response.json({ members: [] });
  }

  const { data: profiles } =
    await selectProfiles(supabase, otherIds);

  const roleById = new Map(
    (memberships ?? []).map((membership) => [
      membership.user_id,
      membership.role,
    ])
  );

  const members = (profiles ?? []).map(
    (profile) => ({
      ...profile,
      role: roleById.get(profile.id) ?? "member",
      you: profile.id === user.id,
    })
  );

  // Anyone invited who has not signed up yet.
  // They belong in the roster, greyed out, so it
  // is obvious the invite was sent.

  const { data: invites } = await supabase
    .from("project_invites")
    .select("id, email, role, created_at")
    .eq("project_id", projectId)
    .is("accepted_at", null);

  return Response.json({
    members,
    invites: invites ?? [],
  });
}


// Usernames arrive with migration 0011. Ask for
// them, and fall back rather than failing the
// whole sidebar on a database that is behind.

async function selectProfiles(
  supabase: Awaited<
    ReturnType<typeof createClient>
  >,
  ids: string[]
) {
  const withUsername = await supabase
    .from("profiles")
    .select(
      "id, email, display_name, username, avatar_url"
    )
    .in("id", ids);

  if (!withUsername.error) {
    return withUsername;
  }

  return supabase
    .from("profiles")
    .select("id, email, display_name, avatar_url")
    .in("id", ids);
}


// ==========================================
// INVITING SOMEBODY
// ==========================================
//
// By email, because that is all you know about
// someone who has not signed up yet.
//
// If they already have an account they are added
// to the project now. If they do not, the invite
// waits until they sign up and is claimed on
// their first visit.
//

// ------------------------------------------
// TELLING THEM
// ------------------------------------------
//
// An email from our address to anyone somebody
// types in is exactly what a spammer wants, so
// each person gets a daily allowance of invite
// emails. Past it, the invite is still made - it
// just is not mailed.
//

const DAILY_INVITE_EMAILS = 25;

function siteFor(request: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;

  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Fall through to the request.
    }
  }

  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host");

  const proto =
    request.headers.get("x-forwarded-proto") ??
    new URL(request.url).protocol.replace(":", "");

  return host ? `${proto}://${host}` : new URL(request.url).origin;
}


async function tell(options: {
  request: Request;
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  userEmail: string | null;
  projectId: string;
  to: string;
  hasAccount: boolean;
}) {
  const since = new Date(
    Date.now() - 24 * 60 * 60 * 1000
  ).toISOString();

  const { count } = await options.supabase
    .from("project_invites")
    .select("*", { count: "exact", head: true })
    .eq("invited_by", options.userId)
    .gte("created_at", since);

  if ((count ?? 0) > DAILY_INVITE_EMAILS) {
    return { sent: false as const, reason: "limit" as const };
  }

  const [{ data: project }, { data: inviter }] =
    await Promise.all([
      options.supabase
        .from("projects")
        .select("name")
        .eq("id", options.projectId)
        .maybeSingle(),

      options.supabase
        .from("profiles")
        .select("display_name, email")
        .eq("id", options.userId)
        .maybeSingle(),
    ]);

  return sendEmail(
    projectInviteEmail({
      to: options.to,
      inviterName: inviter?.display_name ?? null,
      inviterEmail: inviter?.email ?? options.userEmail,
      projectName: project?.name ?? "a project",
      site: siteFor(options.request),
      hasAccount: options.hasAccount,
    })
  );
}


export async function POST(
  request: Request,
  context: RouteContext
) {
  const { id: projectId } = await context.params;

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

  if (!uuidRegex.test(projectId)) {
    return Response.json(
      { error: "Invalid project ID." },
      { status: 400 }
    );
  }

  // Only an owner or admin may add members. Reading
  // the actor's own role, so RLS keeps it honest.

  const { data: membership } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  const actorRole =
    (membership?.role as ProjectRole | undefined) ??
    null;

  if (!actorRole) {
    return Response.json(
      {
        error:
          "You are not a member of this project.",
      },
      { status: 403 }
    );
  }

  if (!can(actorRole, "manage_members")) {
    return Response.json(
      {
        error:
          "Only an owner or admin can add members.",
      },
      { status: 403 }
    );
  }

  // Paid Team is for up to five people, counting invites
  // still waiting to be accepted; a bigger team is
  // Enterprise. Only the paid plan: the free trial lets a
  // bigger team try Teamski first, and a self-hosted copy
  // has no seat limit at all.
  const counter = adminClient() ?? supabase;

  const billing = await projectPlan(counter, projectId);

  if (billing.plan === "team" && billing.provider === "razorpay") {
    const [{ count: members }, { count: invited }] = await Promise.all([
      counter
        .from("project_members")
        .select("*", { count: "exact", head: true })
        .eq("project_id", projectId),

      counter
        .from("project_invites")
        .select("*", { count: "exact", head: true })
        .eq("project_id", projectId)
        .is("accepted_at", null),
    ]);

    if ((members ?? 0) + (invited ?? 0) >= TEAM_MAX_MEMBERS) {
      return Response.json(
        {
          error: `Team is for up to ${TEAM_MAX_MEMBERS} people. For a bigger team, contact us about Enterprise.`,
          enterprise: true,
        },
        { status: 403 }
      );
    }
  }

  const body = (await request
    .json()
    .catch(() => ({}))) as {
    email?: string;
    query?: string;
    role?: string;
  };

  // A member, or a viewer who only reads the channels
  // they are given. Never an owner or admin from here.
  const joinAs: "member" | "viewer" =
    body.role === "viewer" ? "viewer" : "member";

  // One box takes either an email or a @username.
  const raw = (body.query ?? body.email ?? "").trim();

  // A @handle, or anything with no "@", is a
  // username. Everything else is treated as an
  // email.
  const asUsername = raw.replace(/^@+/, "");
  const isUsername =
    raw.startsWith("@") || !raw.includes("@");

  // Looked up with the service role on purpose:
  // profiles are only readable to teammates now,
  // and the whole point here is finding somebody
  // who is not a teammate yet. Only their id, name,
  // email and username are read, only to add them,
  // and only by a member of this project (checked
  // above).

  const lookup = adminClient() ?? supabase;

  // Captured so the inner helper keeps the checked,
  // non-null user.
  const actor = user;

  // Add somebody who already has an account, by
  // their profile. Used by both the username and
  // the email paths.

  async function addExistingUser(person: {
    id: string;
    email: string | null;
    display_name: string | null;
  }) {
    const { error } = await supabase
      .from("project_members")
      .insert({
        project_id: projectId,
        user_id: person.id,
        role: joinAs,
      });

    // 23505: they were already in the project.
    if (error && error.code !== "23505") {
      return Response.json(
        { error: error.message },
        { status: 500 }
      );
    }

    const mailed =
      error || !person.email
        ? null
        : await tell({
            request,
            supabase,
            userId: actor.id,
            userEmail: actor.email ?? null,
            projectId,
            to: person.email,
            hasAccount: true,
          });

    const who = person.display_name || person.email || "They";

    if (!error) {
      await audit({
        projectId,
        actorId: actor.id,
        action: "member.add",
        target: person.email ?? who,
        details: { role: joinAs },
      });
    }

    return Response.json({
      emailed: mailed?.sent ?? false,
      added: true,
      member: {
        id: person.id,
        email: person.email,
        display_name: person.display_name,
        role: joinAs,
      },
      message: error
        ? `${who} is already in this project.`
        : `${who} was added.`,
    });
  }

  // ----------------------------------------
  // BY USERNAME
  // ----------------------------------------

  if (isUsername) {
    const handle = asUsername;

    if (!/^[a-zA-Z0-9_.-]{2,24}$/.test(handle)) {
      return Response.json(
        {
          error:
            "Enter a teammate's email, or a @username of 2 to 24 letters, numbers, dots, dashes or underscores.",
        },
        { status: 400 }
      );
    }

    // ilike is case-insensitive but treats "_" as
    // a wildcard, so the exact match is confirmed
    // in code rather than trusted from the query.

    const { data: rows } = await lookup
      .from("profiles")
      .select("id, email, display_name, username")
      .ilike("username", handle)
      .limit(5);

    const found = (
      (rows ?? []) as {
        id: string;
        email: string | null;
        display_name: string | null;
        username: string | null;
      }[]
    ).find(
      (row) =>
        (row.username ?? "").toLowerCase() ===
        handle.toLowerCase()
    );

    if (!found) {
      return Response.json(
        {
          error: `No one on Teamski has the username @${handle}.`,
        },
        { status: 404 }
      );
    }

    if (found.id === user.id) {
      return Response.json(
        { error: "You are already here." },
        { status: 400 }
      );
    }

    return addExistingUser(found);
  }

  // ----------------------------------------
  // BY EMAIL
  // ----------------------------------------

  const email = raw.toLowerCase();

  if (!email.includes("@")) {
    return Response.json(
      { error: "That is not an email address." },
      { status: 400 }
    );
  }

  if (email === user.email?.toLowerCase()) {
    return Response.json(
      { error: "You are already here." },
      { status: 400 }
    );
  }

  // Already has an account? Then this is not an
  // invite, it is just adding them.

  const { data: existing } = await lookup
    .from("profiles")
    .select("id, email, display_name")
    .ilike("email", email)
    .maybeSingle();

  if (existing) {
    return addExistingUser(existing);
  }

  const { data: invite, error } = await supabase
    .from("project_invites")
    .insert({
      project_id: projectId,
      email,
      role: joinAs,
      invited_by: user.id,
    })
    .select("id, email, role, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return Response.json(
        {
          error: `${email} has already been invited.`,
        },
        { status: 409 }
      );
    }

    if (
      error.code === "42P01" ||
      error.code === "PGRST205"
    ) {
      return Response.json(
        {
          error:
            "Run supabase/migrations/0011_identity.sql to enable invites.",
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

  await audit({
    projectId,
    actorId: user.id,
    action: "member.invite",
    target: email,
    details: { role: joinAs },
  });

  // The invite is real either way, and is claimed
  // the moment they sign up with this address. The
  // email is how they find out.

  const mailed = await tell({
    request,
    supabase,
    userId: user.id,
    userEmail: user.email ?? null,
    projectId,
    to: email,
    hasAccount: false,
  });

  return Response.json({
    invited: true,
    invite,
    emailed: mailed.sent,

    message: mailed.sent
      ? `Invite sent to ${email}. They join this project when they sign up.`
      : mailed.reason === "limit"
        ? `${email} will join this project when they sign up. You have sent a lot of invites today, so this one was not emailed - send them the link yourself.`
        : mailed.reason === "not-configured"
          ? `${email} will join this project when they sign up. Send them the link yourself - invite emails are not set up.`
          : `${email} will join this project when they sign up, but the invite email could not be sent. Send them the link yourself.`,
  });
}


// ==========================================
// REMOVING SOMEBODY
// ==========================================

// ------------------------------------------
// CHANGING SOMEONE'S ROLE
// ------------------------------------------
//
// Owner or admin may make a member an admin, or an
// admin a member. Nobody sets an owner here: there
// is one owner, and handing the project over is a
// separate, deliberate act (and pays the bill).

export async function PATCH(
  request: Request,
  context: RouteContext
) {
  const { id: projectId } = await context.params;

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
    userId?: string;
    role?: string;
  };

  const targetId = (body.userId ?? "").trim();
  const nextRole = (body.role ?? "").trim();

  if (!targetId) {
    return Response.json(
      { error: "Say whose role to change." },
      { status: 400 }
    );
  }

  if (
    nextRole !== "admin" &&
    nextRole !== "member" &&
    nextRole !== "viewer"
  ) {
    return Response.json(
      {
        error:
          "Someone can be an admin, a member or a viewer.",
      },
      { status: 400 }
    );
  }

  const { data: membership } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  const actorRole =
    (membership?.role as ProjectRole | undefined) ??
    null;

  if (!actorRole) {
    return Response.json(
      {
        error:
          "You are not a member of this project.",
      },
      { status: 403 }
    );
  }

  if (!can(actorRole, "manage_members")) {
    return Response.json(
      {
        error:
          "Only an owner or admin can change roles.",
      },
      { status: 403 }
    );
  }

  // The owner's role is not changed from here.

  const { data: target } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", targetId)
    .maybeSingle();

  if (!target) {
    return Response.json(
      { error: "That person is not in this project." },
      { status: 404 }
    );
  }

  if (
    (target.role as ProjectRole) === "owner"
  ) {
    return Response.json(
      {
        error:
          "The owner's role cannot be changed here.",
      },
      { status: 403 }
    );
  }

  // The route has checked the permission; the write
  // goes through the service role so it does not
  // also depend on a row-level policy naming admins.
  const admin = adminClient() ?? supabase;

  const { error } = await admin
    .from("project_members")
    .update({ role: nextRole })
    .eq("project_id", projectId)
    .eq("user_id", targetId);

  if (error) {
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }

  await audit({
    projectId,
    actorId: user.id,
    action: "member.role",
    target: await nameOf(targetId),
    details: { from: target.role, to: nextRole },
  });

  return Response.json({ ok: true, role: nextRole });
}


export async function DELETE(
  request: Request,
  context: RouteContext
) {
  const { id: projectId } = await context.params;

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

  const query = new URL(request.url).searchParams;

  const userId = query.get("userId");
  const inviteId = query.get("inviteId");

  const { data: membership } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  const actorRole =
    (membership?.role as ProjectRole | undefined) ??
    null;

  if (!actorRole) {
    return Response.json(
      {
        error:
          "You are not a member of this project.",
      },
      { status: 403 }
    );
  }

  // Removing yourself (leaving) is always allowed;
  // removing anyone else, or withdrawing an invite,
  // needs the members permission.

  const removingSelf =
    !inviteId && userId === user.id;

  if (
    !removingSelf &&
    !can(actorRole, "manage_members")
  ) {
    return Response.json(
      {
        error:
          "Only an owner or admin can remove members.",
      },
      { status: 403 }
    );
  }

  // The route has checked the permission; the
  // removals go through the service role so they do
  // not also depend on a row-level policy naming
  // admins.
  const admin = adminClient() ?? supabase;

  // Withdrawing an invite.

  if (inviteId) {
    const { data: withdrawn, error } = await admin
      .from("project_invites")
      .delete()
      .eq("id", inviteId)
      .eq("project_id", projectId)
      .select("email");

    if (error) {
      return Response.json(
        { error: error.message },
        { status: 500 }
      );
    }

    const gone = (withdrawn ?? []) as { email: string }[];

    if (gone.length > 0) {
      await audit({
        projectId,
        actorId: user.id,
        action: "invite.withdraw",
        target: gone[0].email,
      });
    }

    return Response.json({ ok: true });
  }

  if (!userId) {
    return Response.json(
      { error: "Say who to remove." },
      { status: 400 }
    );
  }

  // The owner is the one who pays and cannot be
  // removed by anyone, including themselves: the
  // project has to be transferred or deleted
  // instead, so it never ends up paid-for but
  // ownerless.

  const { data: target } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (
    (target?.role as ProjectRole | undefined) ===
    "owner"
  ) {
    return Response.json(
      {
        error:
          "The owner cannot be removed. Transfer ownership or delete the project instead.",
      },
      { status: 403 }
    );
  }

  // Leaving is fine. Removing the last member
  // would leave a project nobody can reach.

  const { count } = await supabase
    .from("project_members")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId);

  if ((count ?? 0) <= 1) {
    return Response.json(
      {
        error:
          "This is the only member. Removing them would leave the project with nobody in it.",
      },
      { status: 400 }
    );
  }

  const { error } = await admin
    .from("project_members")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId);

  if (error) {
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }

  await audit({
    projectId,
    actorId: user.id,
    action: removingSelf ? "member.leave" : "member.remove",
    target: await nameOf(userId),
  });

  return Response.json({ ok: true });
}


// Someone's email or name, for the audit log.
async function nameOf(userId: string) {
  const reader = adminClient();

  if (!reader) {
    return userId;
  }

  const { data } = await reader
    .from("profiles")
    .select("email, display_name")
    .eq("id", userId)
    .maybeSingle();

  const row = data as { email?: string | null; display_name?: string | null } | null;

  return row?.email || row?.display_name || userId;
}
