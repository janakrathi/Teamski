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
