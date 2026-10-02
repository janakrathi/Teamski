import type { SupabaseClient } from "@supabase/supabase-js";

import { costOf } from "./cost.ts";


// ==========================================
// HAS THE PROJECT SPENT ENOUGH
// ==========================================
//
// Checked before a turn that would be charged to
// somebody else's key, never after. A limit that
// reports the overspend is an invoice with extra
// steps.
//
// Only the shared key has a ceiling. Somebody
// spending their own money does not need this
// app's permission.
//

export function startOfMonth() {
  const now = new Date();

  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      1
    )
  ).toISOString();
}


export async function projectOverspent(
  admin: SupabaseClient | null,
  projectId: string | null,
  service: string
): Promise<{ over: boolean; limit: number | null; spent: number }> {
  const none = {
    over: false,
    limit: null,
    spent: 0,
  };

  if (!admin || !projectId) {
    return none;
  }

  const { data: key } = await admin
    .from("project_model_keys")
    .select("monthly_limit_usd")
    .eq("project_id", projectId)
    .eq("service", service)
    .maybeSingle();

  const limit = key?.monthly_limit_usd
    ? Number(key.monthly_limit_usd)
    : null;

  // No limit is the honest default: one somebody
  // did not choose would stop their work at a
  // number they never saw.

  if (!limit) {
    return none;
  }

  const { data: rows } = await admin
    .from("usage_events")
    .select("model, prompt_tokens, response_tokens")
    .eq("project_id", projectId)
    .eq("paid_by", "project")
    .gte("created_at", startOfMonth());

  let spent = 0;

  for (const row of (rows ?? []) as {
    model: string;
    prompt_tokens: number;
    response_tokens: number;
  }[]) {
    spent += costOf(
      row.model,
      row.prompt_tokens,
      row.response_tokens
    ).usd;
  }

  return { over: spent >= limit, limit, spent };
}
