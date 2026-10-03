import { test } from "node:test";

import assert from "node:assert/strict";

import {
  shouldThink,
  wantsFiles,
  wantsImage,
} from "../lib/ai/think.ts";


const ask = (message: string) =>
  shouldThink({ message, tools: true, showReasoning: false });


test("requests that need a tool think first", () => {
  for (const message of [
    "what files are there?",
    "save a short launch checklist to notes.md",
    "read notes.md",
    "Search the web for Next.js 16 release notes",
    "look up the price of a VPS",
    "add a row to the budget sheet",
    "create a GitHub issue for the login bug",
    "summarise https://teamski.in",
    "check plan.txt",
  ]) {
    assert.equal(ask(message), true, message);
  }
});


test("conversation answers straight away", () => {
  for (const message of [
    "my favourite number is 7",
    "what do you think of launching on friday?",
    "hi, how are you",
    "explain TCP vs UDP in 3 bullets",
    "I work in marketing",
  ]) {
    assert.equal(ask(message), false, message);
  }
});


test("no tools on offer means no thinking, unless reasoning is shown", () => {
  assert.equal(
    shouldThink({ message: "read notes.md", tools: false, showReasoning: false }),
    false
  );

  assert.equal(
    shouldThink({ message: "hi", tools: false, showReasoning: true }),
    true
  );
});


test("file tools are offered only when the message is about files", () => {
  for (const message of [
    "save this to notes.md",
    "what files are there?",
    "read plan.md",
    "create a file with the agenda",
    "write the summary into a doc",
    "upload the brief",
    "build me a landing page for a crochet company",
    "make our website hero bolder",
    "write some HTML for a pricing table",
  ]) {
    assert.equal(wantsFiles(message), true, message);
  }

  for (const message of [
    "okay there are 5 people in my group: me, ishita, arshika, revika, namna. now divide the topics among these 5 people",
    "research on ai in graphic design",
    "list the risks of launching on friday",
    "show me a plan for next week",
    "what should we do first?",
    "how many pages should our pitch deck have?",
  ]) {
    assert.equal(wantsFiles(message), false, message);
  }
});


test("the image generator is offered only when a picture is asked for", () => {
  for (const message of [
    "generate an image of a mountain at sunset",
    "make me a logo for a coffee brand",
    "draw a cartoon cat",
    "design a poster for our launch",
    "can you create an illustration of a robot",
  ]) {
    assert.equal(wantsImage(message), true, message);
  }

  for (const message of [
    "what's the plan for today?",
    "summarize this document",
    "how do I center a div",
    "make the report shorter",
  ]) {
    assert.equal(wantsImage(message), false, message);
  }
});
