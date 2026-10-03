import { test } from "node:test";

import assert from "node:assert/strict";

import { needsStrongModel, resolveAuto } from "../lib/ai/router.ts";


const user = (content: string, images?: string[]) => ({ role: "user" as const, content, images });


test("quick asks go to the small model", () => {
  for (const message of ["thanks!", "what's our deadline again?", "make this shorter", "who is working on the logo?", "summarise that in one line"]) {
    assert.equal(needsStrongModel({ message, hasImages: false }).strong, false, message);
  }
});


test("real work goes to the strong model", () => {
  for (const message of [
    "build me a landing page for a bakery",
    "debug this error in our checkout",
    "research our top 5 competitors and compare their pricing",
    "write a blog post about remote work",
    "explain step by step how the cache works",
  ]) {
    assert.equal(needsStrongModel({ message, hasImages: false }).strong, true, message);
  }

  assert.equal(needsStrongModel({ message: "x".repeat(600), hasImages: false }).strong, true);
  assert.equal(needsStrongModel({ message: "fix this ```const a = 1```", hasImages: false }).strong, true);
  assert.equal(needsStrongModel({ message: "what is this?", hasImages: true }).strong, true);
});


test("Auto becomes a real model; anything else is left alone", () => {
  assert.equal(resolveAuto("anthropic/auto", { messages: [user("hi there")] }), "anthropic/claude-haiku-4-5");
  assert.equal(resolveAuto("anthropic/auto", { messages: [user("build a landing page")] }), "anthropic/claude-sonnet-5-5");
  assert.equal(resolveAuto("openai/auto", { messages: [user("ok thanks")] }), "openai/gpt-4.1-mini");
  assert.equal(resolveAuto("openai/auto", { messages: [user("analyse this report")] }), "openai/gpt-4.1");

  // Images anywhere in the conversation need the strong model.
  assert.equal(
    resolveAuto("anthropic/auto", { messages: [user("look", ["data:image/png;base64,x"]), user("and?")] }),
    "anthropic/claude-sonnet-5-5"
  );

  for (const model of ["anthropic/claude-sonnet-5-5", "groq/openai/gpt-oss-120b", "qwen3:1.7b", "openrouter/openrouter/auto"]) {
    assert.equal(resolveAuto(model, { messages: [user("hi")] }), model);
  }
});
