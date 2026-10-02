import type { SupabaseClient } from "@supabase/supabase-js";

import type { Scope } from "./memory.ts";


// ==========================================
// USAGE
// ==========================================
//
// Every model call reports its own cost. Writing
// it down is what turns "the agent feels slow"
// into a number someone can act on.
//

export type UsageKind = "chat" | "memory";

export async function recordUsage(
  db: SupabaseClient,
  options: {
    scope: Scope;
    userId: string | null;
    model: string;
    kind: UsageKind;
    promptTokens: number;
    responseTokens: number;
    durationMs: number;
    toolCalls?: number;

    // Whose account was charged. The difference
    // between "Sam used a lot of Claude" and "Sam
    // used a lot of Claude on my card".
    paidBy?: "you" | "project" | "server" | "local";
  }
) {
  // A turn that used nothing is not worth a row.

  if (
    options.promptTokens === 0 &&
    options.responseTokens === 0
  ) {
    return;
  }

  const { error } = await db
    .from("usage_events")
    .insert({
      paid_by: options.paidBy ?? "local",
      project_id: options.scope.projectId,
      channel_id: options.scope.channelId,
      user_id: options.userId,
      model: options.model,
      kind: options.kind,
      prompt_tokens: options.promptTokens,
      response_tokens: options.responseTokens,
      duration_ms: options.durationMs,
      tool_calls: options.toolCalls ?? 0,
    });

  // Usage is telemetry. If the table is missing
  // or the write fails, the chat must not break.

  if (error) {
    console.error(
      "Failed to record usage:",
      error.message
    );
  }
}


export type UsageSummary = {
  totalPromptTokens: number;
  totalResponseTokens: number;
  totalMs: number;
  turns: number;
  byModel: {
    model: string;
    tokens: number;
    turns: number;
  }[];
};

export async function getUsage(
  db: SupabaseClient,
  scope: Scope,
  sinceDays = 30
): Promise<UsageSummary> {
  const since = new Date(
    Date.now() - sinceDays * 86_400_000
  ).toISOString();

  let query = db
    .from("usage_events")
    .select(
      "model, prompt_tokens, response_tokens, duration_ms"
    )
    .eq("project_id", scope.projectId)
    .gte("created_at", since);

  if (scope.channelId) {
    query = query.eq(
      "channel_id",
      scope.channelId
    );
  }

  const { data, error } = await query;

  const empty: UsageSummary = {
    totalPromptTokens: 0,
    totalResponseTokens: 0,
    totalMs: 0,
    turns: 0,
    byModel: [],
  };

  if (error || !data) {
    if (error) {
      console.error(
        "Failed to read usage:",
        error.message
      );
    }

    return empty;
  }

  const models = new Map<
    string,
    { tokens: number; turns: number }
  >();

  const summary = data.reduce((total, row) => {
    const tokens =
      (row.prompt_tokens ?? 0) +
      (row.response_tokens ?? 0);

    const entry = models.get(row.model) ?? {
      tokens: 0,
      turns: 0,
    };

    entry.tokens += tokens;
    entry.turns += 1;

    models.set(row.model, entry);

    return {
      totalPromptTokens:
        total.totalPromptTokens +
        (row.prompt_tokens ?? 0),

      totalResponseTokens:
        total.totalResponseTokens +
        (row.response_tokens ?? 0),

      totalMs:
        total.totalMs + (row.duration_ms ?? 0),

      turns: total.turns + 1,
      byModel: total.byModel,
    };
  }, empty);

  return {
    ...summary,

    byModel: [...models.entries()]
      .map(([model, entry]) => ({
        model,
        ...entry,
      }))
      .sort((a, b) => b.tokens - a.tokens),
  };
}
