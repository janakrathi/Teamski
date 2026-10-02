import { test } from "node:test";

import assert from "node:assert/strict";

import { createAlerter, redact } from "../lib/alerts.ts";


function harness() {
  let clock = 0;

  const sent: { key: string; level?: string; repeats: number }[] = [];

  const raise = createAlerter({
    now: () => clock,
    cooldownMs: 1000,
    send: async (alert) => {
      sent.push({ key: alert.key, level: alert.level, repeats: alert.repeats });
    },
  });

  return { raise, sent, advance: (ms: number) => (clock += ms) };
}


test("a problem that keeps happening emails once, then once per cooldown with a count", async () => {
  const { raise, sent, advance } = harness();

  await raise({ key: "ai-down", title: "AI down" });
  await raise({ key: "ai-down", title: "AI down" });
  await raise({ key: "ai-down", title: "AI down" });

  assert.equal(sent.length, 1);

  advance(1001);

  await raise({ key: "ai-down", title: "AI down" });

  assert.equal(sent.length, 2);
  assert.equal(sent[1].repeats, 2);
});


test("different problems do not hold each other back", async () => {
  const { raise, sent } = harness();

  await raise({ key: "ai-down", title: "AI down" });
  await raise({ key: "db-down", title: "DB down" });

  assert.deepEqual(sent.map((item) => item.key), ["ai-down", "db-down"]);
});


test("recovery is only announced for a problem that was reported", async () => {
  const { raise, sent } = harness();

  await raise({ key: "ai-down", title: "AI back", level: "resolved" });

  assert.equal(sent.length, 0);

  await raise({ key: "ai-down", title: "AI down" });
  await raise({ key: "ai-down", title: "AI back", level: "resolved" });
  await raise({ key: "ai-down", title: "AI back", level: "resolved" });

  assert.deepEqual(sent.map((item) => item.level ?? "problem"), ["problem", "resolved"]);

  // Down again straight after coming back is a new email.
  await raise({ key: "ai-down", title: "AI down" });

  assert.equal(sent.length, 3);
});


test("keys, tokens and passwords never reach an email", () => {
  const text = redact(
    [
      "Incorrect API key provided: sk-proj-abcdefghijklmnop1234",
      "google said AIzaSyA1234567890abcdefghijklmnop is invalid",
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123",
      "GET https://api.example.com/x?key=supersecret&page=2",
      "postgresql://postgres.abc:myDbPassw0rd@aws-0.pooler.supabase.com:5432/postgres",
      "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstu",
      "resend re_123456789012345678",
    ].join("\n")
  );

  for (const secret of [
    "sk-proj-abcdefghijklmnop1234",
    "AIzaSyA1234567890abcdefghijklmnop",
    "abcdefghijklmnopqrstuvwxyz0123",
    "supersecret",
    "myDbPassw0rd",
    "eyJhbGciOiJIUzI1NiJ9",
    "re_123456789012345678",
  ]) {
    assert.ok(!text.includes(secret), `${secret} leaked`);
  }

  assert.match(text, /page=2/);
});
