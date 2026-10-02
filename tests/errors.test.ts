import { test } from "node:test";

import assert from "node:assert/strict";

import {
  friendlyModelError,
  isToolError,
} from "../lib/ai/errors.ts";


test("the harmony 'Tools should have a name' failure is a tool error", () => {
  const raw =
    "400 failed to template request: failed to render tokenized output: failed to render tokens with harmony: HarmonyError: EncodingError: Message=render failed: Tools should have a name!";

  assert.equal(isToolError(new Error(raw)), true);
});


test("invented and un-offered tool calls are tool errors", () => {
  assert.equal(
    isToolError(new Error("tool call validation failed")),
    true
  );

  assert.equal(
    isToolError(
      new Error("dalle_generate is not in request.tools")
    ),
    true
  );
});


test("an ordinary failure is not a tool error", () => {
  assert.equal(
    isToolError(new Error("network timeout")),
    false
  );
});


test("raw provider errors become plain, non-technical sentences", () => {
  const harmony = friendlyModelError(
    new Error(
      "failed to render tokens with harmony: Tools should have a name!"
    )
  );

  // No leaked jargon, and it reads like a sentence.
  assert.doesNotMatch(harmony, /harmony|template|token/i);
  assert.match(harmony, /tool/i);

  // A rate limit tells the person to wait.
  assert.match(
    friendlyModelError(new Error("rate limit exceeded")),
    /try again|moment|second/i
  );

  // Too-large points at shortening.
  assert.match(
    friendlyModelError(
      new Error("Request too large for model")
    ),
    /shorter|less|fewer|smaller/i
  );

  // A 429 carried as a status, not text, still classifies.
  assert.match(
    friendlyModelError({ status: 429 }),
    /try again|moment|second/i
  );
});


test("a rejected key points at settings, not a stack trace", () => {
  const message = friendlyModelError(
    Object.assign(new Error("invalid api key"), {
      status: 401,
    })
  );

  assert.match(message, /key/i);
  assert.match(message, /settings/i);
});


test("the daily-limit error keeps its own wording", () => {
  const limit = Object.assign(
    new Error("You have used all 20 messages for today."),
    { name: "DailyLimitError" }
  );

  assert.equal(
    friendlyModelError(limit),
    "You have used all 20 messages for today."
  );
});


test("an unknown failure gets a calm generic line", () => {
  const message = friendlyModelError(
    new Error("kaboom 0xdeadbeef")
  );

  assert.doesNotMatch(message, /kaboom|0xdeadbeef/);
  assert.match(message, /try again|went wrong/i);
});
