import "server-only";

import { adminClient } from "@/lib/supabase/admin";


// ==========================================
// THE AUDIT LOG
// ==========================================
//
// Who changed what in a project: people added and
// removed, roles, channel access, shared keys, skills,
// exports. Owners and admins read it in Settings.
//
// Written with the service role after the route has
// done its own permission check, so nobody can write
// or rewrite an entry from a browser. A failed write
// never fails the change it describes - before
// migration 0034 there is no table to write to.
//

export type AuditAction =
  | "member.add"
  | "member.invite"
  | "member.role"
  | "member.remove"
  | "member.leave"
  | "invite.withdraw"
  | "channel.create"
  | "channel.rename"
  | "channel.delete"
  | "channel.access"
  | "key.add"
  | "key.remove"
  | "schedule.add"
  | "schedule.remove"
  | "skill.add"
  | "skill.remove"
  | "skill.toggle"
  | "skill.refresh"
  | "project.export";

export async function audit(entry: {
  projectId: string;
  actorId: string | null;
  action: AuditAction;
  target?: string | null;
  details?: Record<string, unknown>;
}) {
  const admin = adminClient();

  if (!admin) {
    return;
  }

  try {
    const { error } = await admin.from("audit_log").insert({
      project_id: entry.projectId,
      actor_id: entry.actorId,
      action: entry.action,
      target: entry.target ?? null,
      details: entry.details ?? {},
    } as never);

    if (error && error.code !== "42P01" && error.code !== "PGRST205") {
      console.warn("[audit] not recorded:", error.message);
    }
  } catch (cause) {
    console.warn("[audit] not recorded:", cause);
  }
}
