import { test } from "node:test";

import assert from "node:assert/strict";

import { modelDisplayName } from "../lib/ai/modelName.ts";


test("model ids read as the names people use", () => {
  const cases: [string, string][] = [
    ["groq/openai/gpt-oss-120b", "GPT-OSS 120B"],
    ["openai/gpt-oss-120b", "GPT-OSS 120B"],
    ["groq/qwen/qwen3.8-27b", "Qwen3.8 27B"],
    ["google/gemini-3.5-flash-lite", "Gemini 3.5 Flash Lite"],
    ["anthropic/claude-sonnet-5-5", "Claude Sonnet 5.5"],
    ["anthropic/claude-haiku-4-5-20251001", "Claude Haiku 4.5"],
    ["openai/gpt-5.5", "GPT-5.5"],
    ["mistral/mistral-large-latest", "Mistral Large"],
    ["nvidia/nvidia/nemotron-3.5-lightning-30b-a3b", "Nemotron 3.5 Lightning 30B A3B"],
    ["qwen3:1.7b", "Qwen3 1.7B"],
    ["openrouter/deepseek/deepseek-v3.2", "DeepSeek V3.2"],
  ];

  for (const [id, name] of cases) {
    assert.equal(modelDisplayName(id), name, id);
  }
});

test("no model means no name, so the reply says Agent", () => {
  assert.equal(modelDisplayName(null), null);
  assert.equal(modelDisplayName(""), null);
});
