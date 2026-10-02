// ==========================================
// MENTIONS
// ==========================================
//
// A handle is derived from the person rather
// than stored, so there is nothing to keep in
// sync and no separate table to write. The
// composer inserts "@handle" and the server
// derives the same handle from the same member
// list, so both sides always agree.
//

// The assistant answers to a name too, so a
// message can address a person and still ask the
// agent for something. Reserved, so nobody can
// take it by being called Agent.

export const AGENT_ID = "__agent__";

export const AGENT_HANDLE = "agent";


export type Mentionable = {
  id: string;
  email: string;
  display_name?: string | null;

  // Chosen in settings. When it is set, it is
  // the answer to both "what do they type" and
  // "what do we show".
  username?: string | null;
};


// The name someone would actually type. First
// name where there is one, otherwise the local
// part of their email.
//
//   "Priya Sharma"   -> priya
//   "sam@work.com"   -> sam

function baseHandle(member: Mentionable): string {
  // Somebody who has picked a username has said
  // what they want to be called. Nothing derived
  // from their name or address beats that, and
  // it is already unique and already the right
  // shape.

  const chosen = member.username?.trim();

  if (chosen) {
    return chosen.toLowerCase();
  }

  const source =
    member.display_name?.trim().split(/\s+/)[0] ||
    member.email.split("@")[0] ||
    "";

  return (
    source
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, "") ||
    member.id.slice(0, 8)
  );
}


// The whole name, for when first names collide.

function fullHandle(member: Mentionable): string {
  const chosen = member.username?.trim();

  if (chosen) {
    return chosen.toLowerCase();
  }

  const source =
    member.display_name?.trim() ||
    member.email.split("@")[0] ||
    "";

  return (
    source
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[^a-z0-9._-]/g, "") ||
    member.id.slice(0, 8)
  );
}


export function handleFor(
  member: Mentionable
): string {
  return baseHandle(member);
}


// Two people called Sam cannot share a handle, or
// a mention would be ambiguous. They fall back to
// their full name, and only to an id fragment if
// that still collides.

export function handlesFor(
  members: Mentionable[]
): Map<string, string> {
  const shared = new Map<string, number>();

  for (const member of members) {
    const base = baseHandle(member);

    shared.set(
      base,
      (shared.get(base) ?? 0) + 1
    );
  }

  const handles = new Map<string, string>();

  const used = new Map<string, number>();

  for (const member of members) {
    const base = baseHandle(member);

    let handle =
      (shared.get(base) ?? 0) > 1
        ? fullHandle(member)
        : base;

    // Someone called Agent does not get to be the
    // agent.

    if (handle === AGENT_HANDLE) {
      handle = fullHandle(member);

      if (handle === AGENT_HANDLE) {
        handle = `${handle}-${member.id.slice(0, 4)}`;
      }
    }

    // Still not unique - two identical names.

    if ((used.get(handle) ?? 0) > 0) {
      handle = `${handle}-${member.id.slice(0, 4)}`;
    }

    used.set(
      handle,
      (used.get(handle) ?? 0) + 1
    );

    handles.set(member.id, handle);
  }

  return handles;
}


const MENTION = /@([a-z0-9._-]+)/gi;


// Everyone named in a message, as user ids.
// Unknown handles are ignored rather than
// guessed at.

export function findMentioned(
  content: string,
  members: Mentionable[]
): string[] {
  if (!content.includes("@")) {
    return [];
  }

  const handles = handlesFor(members);

  const byHandle = new Map<string, string>();

  for (const [id, handle] of handles) {
    byHandle.set(handle, id);
  }

  const found = new Set<string>();

  for (const match of content.matchAll(MENTION)) {
    const id = byHandle.get(
      match[1].toLowerCase()
    );

    if (id) {
      found.add(id);
    }
  }

  return [...found];
}


// Whether the agent was asked for directly.
// Mentioning a person keeps the agent out of a
// conversation, unless it is named as well.

export function mentionsAgent(
  content: string
): boolean {
  if (!content.includes("@")) {
    return false;
  }

  for (const match of content.matchAll(MENTION)) {
    if (
      match[1].toLowerCase() === AGENT_HANDLE
    ) {
      return true;
    }
  }

  return false;
}


export function displayName(
  member: Mentionable
) {
  return (
    member.display_name?.trim() ||
    member.username?.trim() ||
    member.email ||
    "Someone"
  );
}
