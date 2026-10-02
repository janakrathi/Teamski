import { test } from "node:test";

import assert from "node:assert/strict";

import { TEMPLATES, templateById } from "../lib/agents/templates.ts";


test("templates fit what a channel agent can hold", () => {
  const ids = new Set<string>();

  for (const template of TEMPLATES) {
    assert.ok(!ids.has(template.id), `duplicate id ${template.id}`);
    ids.add(template.id);

    // The channel route lowercases and dashes names;
    // a suggested name should already look like one.
    assert.match(template.channel, /^[a-z0-9-]{1,40}$/);

    // The settings page trims instructions to 4000
    // and names to 60, so a template must fit or it
    // would be cut the first time someone saves.
    assert.ok(template.instructions.length <= 4000);
    assert.ok(template.agentName.length <= 60);

    assert.ok(template.starters.length >= 2);
  }
});


test("an unknown or missing template is no template", () => {
  assert.equal(templateById("nope"), undefined);
  assert.equal(templateById(null), undefined);
  assert.equal(templateById("research")?.name, "Research");
});
