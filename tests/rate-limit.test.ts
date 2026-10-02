import { test } from "node:test";

import assert from "node:assert/strict";

import {
  IP_RULE,
  RULES,
  SIGNED_IN_IP_RULE,
  clientIp,
  createLimiter,
  floodRuleFor,
  ruleFor,
} from "../lib/rate-limit.ts";


test("a room of signed-in people on one network is not locked out", () => {
  const session = "theme=dark; sb-abcd1234-auth-token=base64-xyz";
  const split = "sb-abcd1234-auth-token.0=part; sb-abcd1234-auth-token.1=part";

  assert.equal(floodRuleFor(session), SIGNED_IN_IP_RULE);
  assert.equal(floodRuleFor(split), SIGNED_IN_IP_RULE);

  // Without a session, the tight per-address rule.
  assert.equal(floodRuleFor(null), IP_RULE);
  assert.equal(floodRuleFor("theme=dark"), IP_RULE);
  assert.equal(floodRuleFor("not-sb-auth-token=x"), IP_RULE);

  // Two hundred people, each tab checking in about
  // twenty times a minute, fit under the signed-in
  // ceiling and not under the anonymous one.
  const take = createLimiter(() => 0);
  let blockedSignedIn = 0;
  let blockedAnonymous = 0;

  for (let i = 0; i < 200 * 20; i++) {
    if (!take(SIGNED_IN_IP_RULE, "203.0.113.9").ok) blockedSignedIn++;
    if (!take(IP_RULE, "203.0.113.9").ok) blockedAnonymous++;
  }

  assert.equal(blockedSignedIn, 0);
  assert.ok(blockedAnonymous > 0);
});


test("the specific rule wins over the general one", () => {
  assert.equal(ruleFor("POST", "/api/chat")?.id, "chat");
  assert.equal(ruleFor("GET", "/api/chat")?.id, "api");
  assert.equal(ruleFor("POST", "/api/projects/abc/members")?.id, "invites");
  assert.equal(ruleFor("GET", "/api/projects/abc/members")?.id, "api");
  assert.equal(ruleFor("POST", "/api/agents/abc/run")?.id, "agent-runs");
  assert.equal(ruleFor("POST", "/api/projects")?.id, "create");
  assert.equal(ruleFor("GET", "/login"), undefined);
});


test("a burst up to the limit passes, the next is refused", () => {
  let time = 0;
  const take = createLimiter(() => time);
  const chat = RULES.find((rule) => rule.id === "chat")!;

  for (let n = 0; n < chat.limit; n++) {
    assert.equal(take(chat, "u1").ok, true);
  }

  const refused = take(chat, "u1");

  assert.equal(refused.ok, false);
  assert.ok(!refused.ok && refused.retryAfterSeconds >= 1);

  // Someone else is not affected.
  assert.equal(take(chat, "u2").ok, true);

  // It refills over time.
  time += chat.windowMs / chat.limit;
  assert.equal(take(chat, "u1").ok, true);
  assert.equal(take(chat, "u1").ok, false);

  time += chat.windowMs;
  assert.equal(take(chat, "u1").ok, true);
});


test("the real address is the last one the proxy added", () => {
  const headers = new Headers({
    "x-forwarded-for": "1.2.3.4, 203.0.113.9",
  });

  assert.equal(clientIp(headers), "203.0.113.9");
  assert.equal(clientIp(new Headers()), "unknown");
});
