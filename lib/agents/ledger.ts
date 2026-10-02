// ==========================================
// WHAT A BACKGROUND RUN USED
// ==========================================
//
// Recorded the way a chat turn is, so a background
// or scheduled run counts wherever usage is shown:
// the built-in daily allowance, a Gemini key's
// limit per model, the spend report.
//
// One row per model and payer for the run, whose
// tool_calls is the number of extra model calls -
// the same "requests = 1 + tool_calls" a chat turn
// is counted by. A run that fell back from one
// Gemini model to another part way gets a row for
// each. Pure, so it can be tested without a worker.
//

export type Payer = "you" | "project" | "server" | "local";

export type UsageLedger = {
  startedAt: number;

  byModel: Map<
    string,
    {
      model: string;
      paidBy: Payer;
      calls: number;
      promptTokens: number;
      responseTokens: number;
    }
  >;
};


export function newLedger(now = Date.now()): UsageLedger {
  return { startedAt: now, byModel: new Map() };
}


// One model call that finished.

export function tally(
  ledger: UsageLedger,
  step: {
    answeredWith: string;
    paidBy: Payer;
    promptTokens: number;
    responseTokens: number;
  }
) {
  const key = `${step.answeredWith}|${step.paidBy}`;

  const entry = ledger.byModel.get(key) ?? {
    model: step.answeredWith,
    paidBy: step.paidBy,
    calls: 0,
    promptTokens: 0,
    responseTokens: 0,
  };

  entry.calls += 1;
  entry.promptTokens += step.promptTokens;
  entry.responseTokens += step.responseTokens;

  ledger.byModel.set(key, entry);
}


// The usage_events rows for a run, emptying the
// ledger so nothing is recorded twice.

export function ledgerRows(
  ledger: UsageLedger,
  run: {
    project_id: string;
    channel_id: string | null;
    started_by: string | null;
    schedule_id?: string | null;
  },
  now = Date.now()
) {
  const rows = [...ledger.byModel.values()].map((entry, index) => ({
    project_id: run.project_id,
    channel_id: run.channel_id,
    user_id: run.started_by,
    model: entry.model,
    kind: run.schedule_id ? "scheduled" : "agent",
    paid_by: entry.paidBy,
    prompt_tokens: entry.promptTokens,
    response_tokens: entry.responseTokens,
    tool_calls: Math.max(0, entry.calls - 1),

    // The run's time, once.
    duration_ms: index === 0 ? now - ledger.startedAt : 0,
  }));

  ledger.byModel.clear();

  return rows;
}
