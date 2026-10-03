import { test } from "node:test";

import assert from "node:assert/strict";

import { buildSystemPrompt } from "../lib/ai/memory.ts";

import {
  SYSTEM_VOLATILE_MARKER,
  plainSystem,
  splitSystem,
} from "../lib/ai/providers/types.ts";

import { cachedInputRate } from "../lib/ai/providers/openai.ts";

import { anthropicProvider } from "../lib/ai/providers/anthropic.ts";


const FACTS = [
  { id: "1", content: "Demo is Sunday 6pm", shared: true },
  { id: "2", content: "We use Next.js", shared: false },
];


test("what stays the same comes before the marker, what changes comes after", () => {
  const prompt = buildSystemPrompt({
    channelName: "build",
    summary: "They discussed the hero section.",
    facts: FACTS as never,
    customInstructions: "Always answer in British English.",
    toolsAvailable: true,
  });

  const at = prompt.indexOf(SYSTEM_VOLATILE_MARKER);

  assert.ok(at > 0);

  const before = prompt.slice(0, at);
  const after = prompt.slice(at);

  assert.match(before, /British English/);
  assert.match(before, /shared channel/);
  assert.doesNotMatch(before, /Demo is Sunday|hero section/);

  assert.match(after, /Demo is Sunday/);
  assert.match(after, /hero section/);
});


test("with nothing per-turn, there is no marker at all", () => {
  const prompt = buildSystemPrompt({ summary: "", facts: [], toolsAvailable: false });

  assert.equal(prompt.includes(SYSTEM_VOLATILE_MARKER), false);
});


test("the prompt splits at the marker, and other providers never see it", () => {
  const { stable, volatile, system } = splitSystem([
    { role: "system", content: `RULES${SYSTEM_VOLATILE_MARKER}FACTS` },
    { role: "user", content: "hi" },
  ]);

  assert.equal(stable, "RULES");
  assert.equal(volatile, "FACTS");
  assert.equal(system, "RULES\n\nFACTS");
  assert.equal(plainSystem(`A${SYSTEM_VOLATILE_MARKER}B`), "A\n\nB");
});


test("cached input is counted at a cautious discount", () => {
  assert.equal(cachedInputRate("gpt-5-mini"), 0.1);
  assert.equal(cachedInputRate("gpt-4.1"), 0.25);
  assert.equal(cachedInputRate("gpt-4o"), 0.5);
  assert.equal(cachedInputRate("gpt-5", "https://api.groq.com/openai/v1"), 0.5);
});


async function captureClaudeRequest(model: string) {
  const realFetch = globalThis.fetch;

  let body: Record<string, unknown> = {};

  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    body = JSON.parse(String(init?.body ?? "{}"));

    return new Response(
      JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "test stop" } }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const stream = anthropicProvider.stream({
      model,
      credential: { key: "test-key" },
      messages: [
        { role: "system", content: `RULES${SYSTEM_VOLATILE_MARKER}FACTS` },
        { role: "user", content: "hi" },
      ],
    });

    await stream.next().catch(() => null);
  } finally {
    globalThis.fetch = realFetch;
  }

  return body;
}


test("Claude is asked to cache the stable prompt and the growing conversation", async () => {
  const body = await captureClaudeRequest("claude-sonnet-5-5");

  const system = body.system as { text: string; cache_control?: unknown }[];

  assert.equal(system[0].text, "RULES");
  assert.deepEqual(system[0].cache_control, { type: "ephemeral" });
  assert.equal(system[1].text, "FACTS");
  assert.equal(system[1].cache_control, undefined);
  assert.deepEqual(body.cache_control, { type: "ephemeral" });
  assert.ok(body.thinking);
});


test("Haiku runs without adaptive thinking, which it does not accept", async () => {
  const body = await captureClaudeRequest("claude-haiku-4-5");

  assert.equal(body.thinking, undefined);
  assert.deepEqual(body.cache_control, { type: "ephemeral" });
});


test("Claude receives attached images as image blocks, before the question", async () => {
  const { imageBlocks } = await import("../lib/ai/providers/anthropic.ts");

  const blocks = imageBlocks(["data:image/jpeg;base64,AAAA", "https://example.com/x.png", "data:image/tiff;base64,BBBB"]);

  // Only the supported data URL survives; links and unsupported types are skipped.
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0], { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } });

  const realFetch = globalThis.fetch;
  let body: { messages?: { content: unknown }[] } = {};

  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    body = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "stop" } }), { status: 400, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    await anthropicProvider
      .stream({
        model: "claude-sonnet-5-5",
        credential: { key: "test-key" },
        messages: [{ role: "user", content: "what is this?", images: ["data:image/png;base64,CCCC"] }],
      })
      .next()
      .catch(() => null);
  } finally {
    globalThis.fetch = realFetch;
  }

  const content = body.messages?.[0].content as { type: string }[];

  assert.equal(content[0].type, "image");
  assert.equal(content[1].type, "text");
});
