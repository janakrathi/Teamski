import { test } from "node:test";

import assert from "node:assert/strict";

import {
  asksForProjectMemory,
  buildSystemPrompt,
  mergeFacts,
  projectScope,
  type MemoryFact,
} from "../lib/ai/memory.ts";


const fact = (content: string, id = content): MemoryFact => ({
  id,
  content,
  source: "auto",
  created_at: "2026-09-29T10:00:00Z",
});


test("asking to remember for everyone is recognised", () => {
  for (const said of [
    "remember for the whole project that we use Supabase",
    "Note for the team: the demo is on Friday",
    "please keep in mind across all channels that the deadline is Sunday 9pm",
    "Save this for everyone: judges care about the live demo",
  ]) {
    assert.equal(asksForProjectMemory(said), true, said);
  }

  for (const said of [
    "remember that I like tabs",
    "the whole project is due Friday",
    "what did the team decide?",
  ]) {
    assert.equal(asksForProjectMemory(said), false, said);
  }
});


test("shared facts come first, a fact never twice, and the total is capped", () => {
  const merged = mergeFacts(
    [fact("We use React and Supabase"), fact("Demo is Friday")],
    [fact("we use react and supabase", "own-dup"), fact("Compare Clerk vs Auth0"), fact("Cite sources")],
    3
  );

  assert.deepEqual(
    merged.map((f) => [f.content, f.shared]),
    [
      ["We use React and Supabase", true],
      ["Demo is Friday", true],
      ["Compare Clerk vs Auth0", false],
    ]
  );
});


test("the project's shared memory is the no-channel scope", () => {
  assert.deepEqual(projectScope({ projectId: "p1", channelId: "c1" }), {
    projectId: "p1",
    channelId: null,
  });
});


test("a channel's agent sees shared and channel memory as two lists", () => {
  const prompt = buildSystemPrompt({
    projectName: "Hackathon",
    channelName: "build",
    summary: "",
    facts: mergeFacts([fact("Deadline is Sunday 9pm")], [fact("Use Tailwind")], 10),
    toolsAvailable: false,
  });

  assert.match(prompt, /Shared memory for the whole project[\s\S]*- Deadline is Sunday 9pm/);
  assert.match(prompt, /What you remember from #build:\n- Use Tailwind/);
  assert.match(prompt, /remember something for the whole project/);
});


test("outside a channel, memory is one list as before", () => {
  const prompt = buildSystemPrompt({
    projectName: "Hackathon",
    channelName: null,
    summary: "",
    facts: mergeFacts([], [fact("Team of four")], 10),
    toolsAvailable: false,
  });

  assert.match(prompt, /Things you remember about this project and the people in it:\n- Team of four/);
  assert.doesNotMatch(prompt, /Shared memory for the whole project/);
});
