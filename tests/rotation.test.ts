import { test } from "node:test";

import assert from "node:assert/strict";

import {
  __resetRotation,
  keyRecovered,
  keyResting,
  restKey,
  rotationOrder,
} from "../lib/ai/providers/limits.ts";


test("rotation tries free tiers first and paid keys last", () => {
  assert.deepEqual(
    rotationOrder(["openai", "anthropic", "together", "google", "groq"]),
    ["groq", "google", "together", "anthropic", "openai"]
  );
});

test("a service with two keys is tried once", () => {
  assert.deepEqual(rotationOrder(["groq", "openrouter", "groq"]), ["groq", "openrouter"]);
});

test("a key over its limit rests a couple of minutes, longer each time", () => {
  __resetRotation();

  const now = 1_000_000;

  restKey("u:groq", true, now);
  assert.equal(keyResting("u:groq", now + 60_000), true);
  assert.equal(keyResting("u:groq", now + 2 * 60_000 + 1), false);

  restKey("u:groq", true, now);
  assert.equal(keyResting("u:groq", now + 3 * 60_000), true);
  assert.equal(keyResting("u:groq", now + 4 * 60_000 + 1), false);
});

test("a failing key rests longer than a limited one, capped at an hour", () => {
  __resetRotation();

  const now = 1_000_000;

  restKey("u:cerebras", false, now);
  assert.equal(keyResting("u:cerebras", now + 14 * 60_000), true);
  assert.equal(keyResting("u:cerebras", now + 15 * 60_000 + 1), false);

  for (let i = 0; i < 6; i++) {
    restKey("u:cerebras", false, now);
  }

  assert.equal(keyResting("u:cerebras", now + 59 * 60_000), true);
  assert.equal(keyResting("u:cerebras", now + 60 * 60_000 + 1), false);
});

test("a key that answers again is back in the rotation straight away", () => {
  __resetRotation();

  restKey("u:google", true);
  assert.equal(keyResting("u:google"), true);

  keyRecovered("u:google");
  assert.equal(keyResting("u:google"), false);

  // and its next miss starts the count over
  const now = Date.now();
  restKey("u:google", true, now);
  assert.equal(keyResting("u:google", now + 2 * 60_000 + 1), false);
});

test("resting is per person and per provider", () => {
  __resetRotation();

  restKey("a:groq", true);

  assert.equal(keyResting("a:groq"), true);
  assert.equal(keyResting("b:groq"), false);
  assert.equal(keyResting("a:google"), false);
});


import {
  fitsService,
  pickRotationModel,
  requestTokens,
  retryAfterMs,
} from "../lib/ai/providers/rotation.ts";


test("quick asks use the small free model, real work the strong one", () => {
  const gemini = ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"];

  assert.equal(pickRotationModel("google", gemini, false), "gemini-3.5-flash-lite");
  assert.equal(pickRotationModel("google", gemini, true), "gemini-3.8-flash");

  const groq = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];

  assert.equal(pickRotationModel("groq", groq, false), "openai/gpt-oss-20b");
  assert.equal(pickRotationModel("groq", groq, true), "openai/gpt-oss-120b");
});

test("only saved models are picked, and unknown services keep their first", () => {
  // Strong wanted, but only the small model is saved.
  assert.equal(pickRotationModel("mistral", ["mistral-small-latest"], true), "mistral-small-latest");

  assert.equal(pickRotationModel("together", ["a", "b"], true), "a");
  assert.equal(pickRotationModel("openrouter", ["openrouter/auto", "x:free"], false), "x:free");
  assert.equal(pickRotationModel("groq", [], false), null);
});

test("a request too big for Groq's free tier skips it; others take it", () => {
  const big = requestTokens([{ role: "user", content: "x".repeat(40_000) }]);

  assert.ok(big > 6500);
  assert.equal(fitsService("groq", big), false);
  assert.equal(fitsService("google", big), true);
  assert.equal(fitsService("groq", requestTokens([{ role: "user", content: "hi" }])), true);
});

test("the provider's own wait is read from its error", () => {
  assert.equal(retryAfterMs(new Error("Rate limit reached. Please try again in 7m12.5s.")), 432_500);
  assert.equal(retryAfterMs(new Error("429 Please retry in 34.2s")), 34_200);
  assert.equal(retryAfterMs(new Error("Please try again in 960ms")), 960);
  assert.equal(retryAfterMs({ headers: { "retry-after": "20" } }), 20_000);
  assert.equal(retryAfterMs(new Error("Rate limit reached")), null);
});

test("a key rests for as long as its provider asked", () => {
  __resetRotation();

  const now = 1_000_000;

  // A daily limit: hours, not the default two minutes.
  restKey("u:google", true, now, 3 * 3_600_000);
  assert.equal(keyResting("u:google", now + 2 * 3_600_000), true);

  // A per-minute limit: back in seconds.
  restKey("u:groq", true, now, 8_000);
  assert.equal(keyResting("u:groq", now + 9_000), false);
});
