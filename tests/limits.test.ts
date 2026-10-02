import { test } from "node:test";

import assert from "node:assert/strict";

import {
  fallbackOrder,
  isRateLimited,
  pacificDayStart,
  requestsByModel,
  requestsFor,
  unlessLimited,
} from "../lib/ai/providers/limits.ts";


test("a provider's limit refusal is recognised, other errors are not", () => {
  assert.equal(isRateLimited({ status: 429 }), true);
  assert.equal(isRateLimited(new Error("429 Resource has been exhausted (e.g. check quota).")), true);
  assert.equal(isRateLimited(new Error("RESOURCE_EXHAUSTED")), true);
  assert.equal(isRateLimited(new Error("429 Too Many Requests")), true);
  assert.equal(isRateLimited(new Error("Rate limit reached for requests")), true);

  assert.equal(isRateLimited({ status: 400 }), false);
  assert.equal(isRateLimited(new Error("API key not valid")), false);
  assert.equal(isRateLimited(new Error("model returned 4290 tokens")), false);
});


test("Gemini's day starts at midnight Pacific", () => {
  // 14 Sep 2026, 10:00 in India = 04:30 UTC =
  // 21:30 on 13 Sep in California (PDT, UTC-7).
  assert.equal(
    pacificDayStart(new Date("2026-09-14T04:30:00Z")).toISOString(),
    "2026-09-13T07:00:00.000Z"
  );

  // Winter, PST (UTC-8).
  assert.equal(
    pacificDayStart(new Date("2026-01-10T20:00:00Z")).toISOString(),
    "2026-01-10T08:00:00.000Z"
  );
});


test("a turn with tool calls counts as more than one request", () => {
  assert.equal(
    requestsFor([{ tool_calls: 0 }, { tool_calls: 2 }, { tool_calls: null }]),
    5
  );
});


test("a limit refusal before the first word is caught; a real reply passes through whole", async () => {
  const refused = (async function* () {
    throw Object.assign(new Error("429 Too Many Requests"), { status: 429 });
  })();

  assert.equal(await unlessLimited(refused), null);

  const reply = (async function* () {
    yield "Hello";
    yield " there";
  })();

  const passed = await unlessLimited(reply);
  const chunks: string[] = [];

  for await (const chunk of passed!) {
    chunks.push(chunk);
  }

  assert.deepEqual(chunks, ["Hello", " there"]);

  const broken = (async function* () {
    throw new Error("API key not valid");
  })();

  await assert.rejects(unlessLimited(broken), /API key not valid/);
});


test("today's requests are counted per model of the service", () => {
  assert.deepEqual(
    requestsByModel(
      [
        { model: "google/gemini-3.8-flash", tool_calls: 1 },
        { model: "google/gemini-3.5-flash-lite", tool_calls: 0 },
        { model: "google/gemini-3.8-flash", tool_calls: 0 },
        { model: "qwen3:1.7b", tool_calls: 3 },
      ],
      "google"
    ),
    { "gemini-3.8-flash": 3, "gemini-3.5-flash-lite": 1 }
  );
});


test("the next model to try has the most room left, and used-up ones are skipped", () => {
  const models = ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-2.5-flash"];

  // 3.8 Flash is out; Flash-Lite has 480 left, 2.5 Flash 5.
  assert.deepEqual(
    fallbackOrder({
      chosen: "gemini-3.8-flash",
      models,
      used: { "gemini-3.5-flash-lite": 20, "gemini-2.5-flash": 15 },
      limits: { "gemini-3.5-flash-lite": 500, "gemini-3.8-flash": 20, "gemini-2.5-flash": 20 },
    }),
    ["gemini-3.5-flash-lite", "gemini-2.5-flash"]
  );

  // 2.5 Flash already used up by Teamski's count.
  assert.deepEqual(
    fallbackOrder({
      chosen: "gemini-3.5-flash-lite",
      models,
      used: { "gemini-2.5-flash": 20, "gemini-3.8-flash": 4 },
      limits: { "gemini-3.8-flash": 20, "gemini-2.5-flash": 20 },
    }),
    ["gemini-3.8-flash"]
  );

  // No limits entered: the key's own order.
  assert.deepEqual(
    fallbackOrder({ chosen: "gemini-2.5-flash", models, used: {}, limits: {} }),
    ["gemini-3.5-flash-lite", "gemini-3.8-flash"]
  );
});
