import { test } from "node:test";

import assert from "node:assert/strict";

import { ledgerRows, newLedger, tally } from "../lib/agents/ledger.ts";

import { requestsByModel } from "../lib/ai/providers/limits.ts";


const run = {
  project_id: "p",
  channel_id: "c",
  started_by: "u",
  schedule_id: "s",
};


test("a run's model calls become rows that count as that many requests per model", () => {
  const ledger = newLedger(1000);

  // Four steps on 3.8 Flash, which then ran out, and
  // two on Flash-Lite.
  for (let i = 0; i < 4; i++) {
    tally(ledger, { answeredWith: "google/gemini-3.8-flash", paidBy: "you", promptTokens: 100, responseTokens: 10 });
  }

  for (let i = 0; i < 2; i++) {
    tally(ledger, { answeredWith: "google/gemini-3.5-flash-lite", paidBy: "you", promptTokens: 50, responseTokens: 5 });
  }

  const rows = ledgerRows(ledger, run, 4000);

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => [row.model, row.paid_by, row.tool_calls, row.prompt_tokens, row.kind]),
    [
      ["google/gemini-3.8-flash", "you", 3, 400, "scheduled"],
      ["google/gemini-3.5-flash-lite", "you", 1, 100, "scheduled"],
    ]
  );

  // Exactly what the usage ring and the fallback
  // count Gemini by.
  assert.deepEqual(requestsByModel(rows, "google"), {
    "gemini-3.8-flash": 4,
    "gemini-3.5-flash-lite": 2,
  });

  // The run's time is recorded once.
  assert.deepEqual(rows.map((row) => row.duration_ms), [3000, 0]);
});


test("the ledger empties, so a run is never recorded twice", () => {
  const ledger = newLedger();

  tally(ledger, { answeredWith: "qwen3:1.7b", paidBy: "local", promptTokens: 1, responseTokens: 1 });

  assert.equal(ledgerRows(ledger, { ...run, schedule_id: null }).length, 1);
  assert.equal(ledgerRows(ledger, run).length, 0);
});


test("a background task is kind 'agent', a scheduled one 'scheduled'", () => {
  const ledger = newLedger();

  tally(ledger, { answeredWith: "qwen3:1.7b", paidBy: "local", promptTokens: 1, responseTokens: 1 });

  assert.equal(ledgerRows(ledger, { ...run, schedule_id: null })[0].kind, "agent");
});
