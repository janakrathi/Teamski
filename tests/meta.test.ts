import { test } from "node:test";

import assert from "node:assert/strict";

import { metaLoaded, whenMetaLoaded } from "../lib/analytics/meta.ts";


type FakeWindow = { fbq?: { version?: string }; setTimeout: typeof setTimeout };

function fakeWindow(fbq?: { version?: string }): FakeWindow {
  const win: FakeWindow = { fbq, setTimeout };

  (globalThis as unknown as { window: FakeWindow }).window = win;

  return win;
}


test("our stand-in alone is not Meta's library", () => {
  fakeWindow({ version: "2.0" });
  assert.equal(metaLoaded(), false);

  fakeWindow(undefined);
  assert.equal(metaLoaded(), false);

  fakeWindow({ version: "2.9.408" });
  assert.equal(metaLoaded(), true);
});


test("waits for the library, and gives up when it is blocked", async () => {
  const win = fakeWindow({ version: "2.0" });

  // The real library arrives a moment later.
  setTimeout(() => {
    win.fbq = { version: "2.9.408" };
  }, 300);

  assert.equal(await whenMetaLoaded(3000), true);

  // Blocked: it never arrives.
  fakeWindow({ version: "2.0" });
  assert.equal(await whenMetaLoaded(600), false);

  delete (globalThis as unknown as { window?: FakeWindow }).window;
});
