import { test } from "node:test";

import assert from "node:assert/strict";

import { createHash, generateKeyPairSync, sign } from "node:crypto";

import {
  PASTE_REDIRECT,
  grantsPlanUsage,
  hostId,
  originInState,
  parseCallback,
  readEvents,
  redirectFor,
  startSignIn,
  stream,
  toResponsesInput,
  toResponsesTools,
  verifyIdToken,
} from "../lib/ai/providers/chatgpt.ts";

import { isRateLimited } from "../lib/ai/providers/limits.ts";


test("Teamski on this machine takes the callback itself; anywhere else it is pasted", () => {
  assert.deepEqual(redirectFor("http://localhost:3000"), {
    redirectUri: "http://127.0.0.1:3000/api/models/chatgpt/callback",
    paste: false,
  });

  assert.deepEqual(redirectFor("https://team.example.com"), {
    redirectUri: PASTE_REDIRECT,
    paste: true,
  });
});

test("the state brings the browser back only to a loopback address", () => {
  const local = startSignIn({ appOrigin: "http://localhost:3000" }).pending.state;

  assert.equal(originInState(local), "http://localhost:3000");

  const remote = `abc.${Buffer.from("https://evil.example").toString("base64url")}`;

  assert.equal(originInState(remote), null);
  assert.equal(originInState("no-origin-here"), null);
});

test("a first sign-in registers Teamski; a reconnect reuses the issued client id", () => {
  const first = startSignIn({ appOrigin: "http://localhost:3000" });

  const params = new URL(first.url).searchParams;

  assert.equal(params.get("client_id"), "dynamic_agent_client");
  assert.equal(params.get("agent_name_hint"), "Teamski");
  assert.equal(params.get("ext_agent_host_id"), hostId());
  assert.equal(params.get("resource"), "https://api.openai.com/v1");
  assert.match(params.get("scope") ?? "", /chatgpt\.tokens\.use\.direct/);
  assert.equal(
    params.get("code_challenge"),
    createHash("sha256").update(first.pending.verifier).digest("base64url")
  );

  const again = new URL(
    startSignIn({ appOrigin: "http://localhost:3000", clientId: "oaiapp_123" }).url
  ).searchParams;

  assert.equal(again.get("client_id"), "oaiapp_123");
  assert.equal(again.get("agent_name_hint"), null);
});

test("the host id is stable and shaped as OpenAI asks", () => {
  assert.equal(hostId(), hostId());
  assert.match(hostId(), /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("a pasted callback address is read", () => {
  assert.deepEqual(
    parseCallback(" http://127.0.0.1:1455/auth/callback?code=c1&state=s1&client_id=oaiapp_9&scope=openid ")
      ?.clientId,
    "oaiapp_9"
  );

  assert.equal(parseCallback("not a url"), null);

  assert.equal(
    parseCallback("http://127.0.0.1:1455/auth/callback?error=access_denied")?.error,
    "access_denied"
  );
});

test("plan usage is only counted as granted with its scope", () => {
  assert.equal(grantsPlanUsage("openid email chatgpt.tokens.use.direct"), true);
  assert.equal(grantsPlanUsage(undefined, "openid profile"), false);
});


// A token signed with a key made here, checked the way
// OpenAI's would be.

function idToken(claims: Record<string, unknown>) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  const head = Buffer.from(JSON.stringify({ alg: "RS256", kid: "k1" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");

  const signature = sign("RSA-SHA256", Buffer.from(`${head}.${body}`), privateKey).toString("base64url");

  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1" } as { kty: string; kid: string };

  return { token: `${head}.${body}.${signature}`, keys: [jwk] };
}

test("the ID token is verified: signature, issuer, audience, expiry and nonce", async () => {
  const now = Date.now();

  const good = {
    iss: "https://auth.openai.com",
    aud: "oaiapp_1",
    exp: Math.floor(now / 1000) + 600,
    nonce: "n1",
    email: "person@example.com",
  };

  const { token, keys } = idToken(good);

  const claims = await verifyIdToken(token, { clientId: "oaiapp_1", nonce: "n1", keys });

  assert.equal(claims.email, "person@example.com");

  await assert.rejects(verifyIdToken(token, { clientId: "oaiapp_1", nonce: "other", keys }));
  await assert.rejects(verifyIdToken(token, { clientId: "oaiapp_2", nonce: "n1", keys }));

  // Signed by somebody else.
  const forged = idToken(good);

  await assert.rejects(verifyIdToken(forged.token, { clientId: "oaiapp_1", nonce: "n1", keys }));
});


test("the conversation becomes Responses input: system as instructions, tool calls paired", () => {
  const { instructions, input } = toResponsesInput([
    { role: "system", content: "Be brief." },
    { role: "user", content: "What's in notes.md?", images: ["data:image/png;base64,AAA"] },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ function: { name: "read_file", arguments: { path: "notes.md" } } }],
    },
    { role: "tool", tool_name: "read_file", content: "hello" },
    { role: "tool", tool_name: "web_search", content: "orphan" },
    { role: "assistant", content: "It says hello." },
  ]);

  assert.equal(instructions, "Be brief.");

  assert.deepEqual(input, [
    {
      role: "user",
      content: [
        { type: "input_text", text: "What's in notes.md?" },
        { type: "input_image", image_url: "data:image/png;base64,AAA" },
      ],
    },
    {
      type: "function_call",
      call_id: "call_0",
      name: "read_file",
      arguments: JSON.stringify({ path: "notes.md" }),
    },
    { type: "function_call_output", call_id: "call_0", output: "hello" },
    { role: "user", content: "Result of web_search:\norphan" },
    { role: "assistant", content: "It says hello." },
  ]);
});

test("tools are flat, not strict, and nameless ones are dropped", () => {
  const tools = toResponsesTools([
    {
      type: "function",
      function: { name: "read_file", description: "Read", parameters: { type: "object", properties: {} } },
    },
    {
      type: "function",
      function: { name: "", description: "nameless", parameters: { type: "object", properties: {} } },
    },
  ]);

  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "read_file");
  assert.equal(tools[0].strict, false);
});


function sse(events: unknown[], splitAt = 7) {
  const text = events.map((event) => `event: x\ndata: ${JSON.stringify(event)}\n\n`).join("");

  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let at = 0; at < text.length; at += splitAt) {
        controller.enqueue(encoder.encode(text.slice(at, at + splitAt)));
      }

      controller.close();
    },
  });
}

test("events split across network pieces are read whole", async () => {
  const seen = [];

  for await (const event of readEvents(sse([{ type: "a" }, { type: "b", n: 1 }], 3))) {
    seen.push(event);
  }

  assert.deepEqual(seen, [{ type: "a" }, { type: "b", n: 1 }]);
});

test("a streamed reply comes through as text, tool calls and token counts", async () => {
  const original = globalThis.fetch;

  let sent: Record<string, unknown> = {};

  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body));

    return new Response(
      sse([
        { type: "response.output_text.delta", delta: "Hel" },
        { type: "response.output_text.delta", delta: "lo" },
        {
          type: "response.output_item.done",
          item: { type: "function_call", name: "web_search", arguments: "{\"query\":\"x\"}" },
        },
        { type: "response.completed", response: { usage: { input_tokens: 12, output_tokens: 3 } } },
      ]),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const chunks = [];

    for await (const chunk of stream({
      model: "gpt-5",
      credential: { key: "token" },
      messages: [{ role: "user", content: "hi" }],
      options: { temperature: 0.2 },
    })) {
      chunks.push(chunk);
    }

    assert.equal(sent.store, false);
    assert.equal(sent.stream, true);
    assert.equal("temperature" in sent, false);

    assert.equal(chunks.map((chunk) => chunk.message?.content ?? "").join(""), "Hello");
    assert.deepEqual(chunks[2].message?.tool_calls, [
      { function: { name: "web_search", arguments: { query: "x" } } },
    ]);
    assert.equal(chunks[3].prompt_eval_count, 12);
    assert.equal(chunks[3].eval_count, 3);
  } finally {
    globalThis.fetch = original;
  }
});

test("the weekly cap counts as a limit, so the turn moves on", async () => {
  const original = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ error: { code: "subscription_sharing_usage_limit_exceeded" } }),
      { status: 429 }
    )) as typeof fetch;

  try {
    const run = stream({ model: "gpt-5", credential: { key: "t" }, messages: [] });

    await assert.rejects(run.next(), (error) => {
      assert.equal(isRateLimited(error), true);
      assert.match((error as Error).message, /chatgpt\.com\/settings\/usage/);

      return true;
    });
  } finally {
    globalThis.fetch = original;
  }
});

test("the cap reached mid-stream is reported too", async () => {
  const original = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(
      sse([
        {
          type: "response.failed",
          response: { error: { code: "subscription_sharing_usage_limit_exceeded" } },
        },
      ]),
      { status: 200 }
    )) as typeof fetch;

  try {
    const run = stream({ model: "gpt-5", credential: { key: "t" }, messages: [] });

    await assert.rejects(run.next(), (error) => isRateLimited(error));
  } finally {
    globalThis.fetch = original;
  }
});
