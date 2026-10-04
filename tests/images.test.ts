import { test } from "node:test";

import assert from "node:assert/strict";

import { generateImage, imageMime } from "../lib/ai/providers/images.ts";


const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64");

function withFetch(handler: (url: string, init: RequestInit) => Response) {
  const original = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];

  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });

    return handler(url, init);
  }) as typeof fetch;

  return { calls, restore: () => (globalThis.fetch = original) };
}

const creds = { accountId: "acct", token: "tok" };


test("images come from FLUX.2 [klein], sent as a form", async () => {
  const mock = withFetch(() => Response.json({ result: { image: PNG } }));

  try {
    const result = await generateImage("a red bicycle", creds);

    assert.ok(!("error" in result));
    assert.equal(result.mime, "image/png");

    assert.equal(mock.calls.length, 1);
    assert.match(mock.calls[0].url, /flux-2-klein-4b$/);
    assert.ok(mock.calls[0].init.body instanceof FormData);

    const form = mock.calls[0].init.body as FormData;
    assert.equal(form.get("prompt"), "a red bicycle");
    assert.equal(form.get("width"), "1024");
  } finally {
    mock.restore();
  }
});

test("if the newer model fails, the older one still makes the image", async () => {
  const mock = withFetch((url) =>
    url.includes("flux-2-klein")
      ? new Response("model unavailable", { status: 503 })
      : Response.json({ result: { image: JPEG } })
  );

  try {
    const result = await generateImage("a red bicycle", creds);

    assert.ok(!("error" in result));
    assert.equal(result.mime, "image/jpeg");
    assert.equal(mock.calls.length, 2);
    assert.match(mock.calls[1].url, /flux-1-schnell$/);
    assert.equal(JSON.parse(String(mock.calls[1].init.body)).steps, 4);
  } finally {
    mock.restore();
  }
});

test("when both fail, the newer model's reason is reported", async () => {
  const mock = withFetch((url) =>
    url.includes("flux-2-klein")
      ? new Response("daily free allocation exceeded", { status: 429 })
      : new Response("busy", { status: 503 })
  );

  try {
    const result = await generateImage("a red bicycle", creds);

    assert.ok("error" in result);
    assert.match(result.error, /^429/);
  } finally {
    mock.restore();
  }
});

test("no account means no attempt", async () => {
  const saved = [process.env.CLOUDFLARE_ACCOUNT_ID, process.env.CLOUDFLARE_API_TOKEN];

  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;

  try {
    assert.deepEqual(await generateImage("x"), { error: "no-key" });
  } finally {
    if (saved[0]) process.env.CLOUDFLARE_ACCOUNT_ID = saved[0];
    if (saved[1]) process.env.CLOUDFLARE_API_TOKEN = saved[1];
  }
});

test("the image type is read from its bytes", () => {
  assert.equal(imageMime(Buffer.from(PNG, "base64")), "image/png");
  assert.equal(imageMime(Buffer.from(JPEG, "base64")), "image/jpeg");
});
