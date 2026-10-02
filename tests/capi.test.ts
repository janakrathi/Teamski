import { test } from "node:test";

import assert from "node:assert/strict";

import {
  buildMetaEvent,
  metaConfig,
  metaUserFromRequest,
  sendMetaEvents,
  sha256,
} from "../lib/analytics/capi.ts";


test("emails are trimmed and lower-cased before hashing, as Meta expects", () => {
  const event = buildMetaEvent({
    name: "CompleteRegistration",
    id: "registration-abc",
    user: { email: "  Asha@Example.COM " },
  });

  assert.deepEqual(event.user_data.em, [sha256("asha@example.com")]);
  assert.ok(!JSON.stringify(event).includes("asha@example.com"));
});


test("the account id is hashed too, and missing fields are left out", () => {
  const event = buildMetaEvent({
    name: "Lead",
    id: "lead-1",
    user: { externalId: "user-1", ip: "unknown", userAgent: null },
  });

  assert.deepEqual(event.user_data, { external_id: [sha256("user-1")] });
  assert.equal(event.action_source, "website");
  assert.equal(event.event_id, "lead-1");
  assert.ok(!("event_source_url" in event));
});


test("Meta's own cookies and the browser are passed through as they are", () => {
  const user = metaUserFromRequest(
    new Request("https://teamski.in/api/meta/registration", {
      headers: {
        cookie: "sb-token=x; _fbp=fb.1.123.456; _fbc=fb.1.123.abc%3D",
        "user-agent": "Test Browser",
        "x-forwarded-for": "203.0.113.9",
      },
    })
  );

  assert.equal(user.fbp, "fb.1.123.456");
  assert.equal(user.fbc, "fb.1.123.abc=");
  assert.equal(user.userAgent, "Test Browser");
  assert.equal(user.ip, "203.0.113.9");
});


test("with no token nothing is sent and nothing breaks", async () => {
  const saved = process.env.META_CAPI_TOKEN;

  delete process.env.META_CAPI_TOKEN;

  try {
    assert.equal(metaConfig(), null);

    const result = await sendMetaEvents([
      { name: "Lead", id: "x-12345678", user: {} },
    ]);

    assert.deepEqual(result, { sent: false, reason: "not-configured" });
  } finally {
    if (saved !== undefined) process.env.META_CAPI_TOKEN = saved;
  }
});


test("the token travels in the body, never the address, with the test code", async () => {
  const savedFetch = globalThis.fetch;
  const saved = { ...process.env };

  process.env.META_CAPI_TOKEN = "secret-token";
  process.env.META_PIXEL_ID = "1234567890";
  process.env.META_TEST_EVENT_CODE = "TEST123";

  let seenUrl = "";
  let seenBody: Record<string, unknown> = {};

  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seenUrl = String(url);
    seenBody = JSON.parse(String(init.body));

    return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await sendMetaEvents([
      { name: "Lead", id: "lead-12345678", user: { email: "a@b.co" } },
    ]);

    assert.deepEqual(result, { sent: true, received: 1 });
    assert.ok(!seenUrl.includes("secret-token"));
    assert.match(seenUrl, /graph\.facebook\.com\/v\d+\.\d+\/\d+\/events$/);
    assert.equal(seenBody.access_token, "secret-token");
    assert.equal(seenBody.test_event_code, "TEST123");
  } finally {
    globalThis.fetch = savedFetch;
    process.env = saved;
  }
});


test("a refusal from Meta is reported, not thrown", async () => {
  const savedFetch = globalThis.fetch;
  const saved = { ...process.env };

  process.env.META_CAPI_TOKEN = "bad-token";
  process.env.META_PIXEL_ID = "1234567890";
  delete process.env.META_TEST_EVENT_CODE;

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ error: { message: "Invalid OAuth access token." } }),
      { status: 400 }
    )) as unknown as typeof fetch;

  const quiet = console.error;
  console.error = () => {};

  try {
    const result = await sendMetaEvents([
      { name: "Lead", id: "lead-12345678", user: {} },
    ]);

    assert.deepEqual(result, {
      sent: false,
      reason: "failed",
      detail: "Invalid OAuth access token.",
    });
  } finally {
    console.error = quiet;
    globalThis.fetch = savedFetch;
    process.env = saved;
  }
});
