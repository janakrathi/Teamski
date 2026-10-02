import { test } from "node:test";

import assert from "node:assert/strict";

import { TOPICS, cleanContact } from "../lib/contact.ts";

import { contactMessageEmail } from "../lib/email/templates.ts";


const GOOD = {
  name: "  Asha   Rao ",
  email: "Asha@Example.com",
  topic: TOPICS[0],
  message: "Can Teamski work for a 30-person hackathon?\nThanks!",
};


test("a complete message is accepted and tidied", () => {
  const checked = cleanContact(GOOD);

  assert.ok(checked.ok);

  if (checked.ok) {
    assert.equal(checked.message.name, "Asha Rao");
    assert.equal(checked.message.email, "asha@example.com");

    // Line breaks in the message are kept.
    assert.match(checked.message.message, /\n/);
  }
});


test("missing or malformed fields are refused with a reason", () => {
  for (const [field, value] of [
    ["name", ""],
    ["email", "not-an-email"],
    ["topic", "Free money"],
    ["message", "hi"],
  ] as const) {
    const checked = cleanContact({ ...GOOD, [field]: value });

    assert.equal(checked.ok, false, field);
  }
});


test("anything that is not the promised shape is treated as empty", () => {
  assert.equal(cleanContact(null).ok, false);
  assert.equal(cleanContact({ ...GOOD, name: { evil: true } }).ok, false);
});


test("long messages are cut to size", () => {
  const checked = cleanContact({ ...GOOD, message: "x".repeat(10_000) });

  assert.ok(checked.ok);

  if (checked.ok) {
    assert.equal(checked.message.message.length, 3000);
  }
});


test("the notification email escapes what the stranger typed, and replies go to them", () => {
  const email = contactMessageEmail({
    to: "admin@example.com",
    site: "https://teamski.in",
    message: {
      name: "<script>alert(1)</script>",
      email: "asha@example.com",
      topic: TOPICS[0],
      message: "<img src=x onerror=alert(1)>",
    },
  });

  assert.equal(email.replyTo, "asha@example.com");
  assert.doesNotMatch(email.html, /<script>|<img src=x/);
});
