import { test } from "node:test";

import assert from "node:assert/strict";

import { nextStreamed } from "../lib/ai/stream.ts";

import { stripThinking } from "../lib/ai/ollama.ts";


// Feeds pieces the way a model sends them and
// rebuilds what the screen would show.
function play(pieces: string[]) {
  let sent = "";
  let content = "";
  let screen = "";

  for (const piece of pieces) {
    content += piece;

    const next = nextStreamed(sent, content);

    sent = next.sent;

    if (next.reset) {
      screen = "";
    }

    screen += next.text;
  }

  return screen;
}


test("spaces between streamed pieces survive", () => {
  assert.equal(
    play(["I'll", " divide", " the", " topics", " among", " the", " five", " teammates."]),
    "I'll divide the topics among the five teammates."
  );

  assert.equal(play(["Line one", "\n", "\n", "- item"]), "Line one\n\n- item");
});


test("think tags never reach the screen", () => {
  assert.equal(play(["<think>", "plan the", " answer", "</think>", "Hello", " there"]), "Hello there");

  // A tag that opens after text was already shown:
  // what is on screen ends up exactly what the
  // finished reply shows, with the thought gone.
  const pieces = ["Hi", " <think>", "hmm", "</think>", " there"];

  const screen = play(pieces);

  assert.equal(screen, stripThinking(pieces.join("")));
  assert.ok(!screen.includes("hmm"));
});
