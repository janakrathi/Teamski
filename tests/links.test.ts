import { test } from "node:test";

import assert from "node:assert/strict";

import {
  collectUrls,
  keepKnownLinks,
  normalizeUrl,
} from "../lib/ai/links.ts";


test("urls match by shape, not spelling", () => {
  assert.equal(
    normalizeUrl("https://Example.com/Page/"),
    normalizeUrl("https://example.com/Page")
  );

  // Trailing punctuation and a fragment do not count.
  assert.equal(
    normalizeUrl("https://example.com/a#top)."),
    normalizeUrl("https://example.com/a")
  );
});


test("collectUrls finds the links in a tool result", () => {
  const found = collectUrls(
    "1. Title\n   https://real.com/one\n2. Other\n   https://real.com/two"
  );

  assert.ok(found.includes("https://real.com/one"));
  assert.ok(found.includes("https://real.com/two"));
});


test("an invented markdown link is reduced to its text", () => {
  const allowed = new Set([
    normalizeUrl("https://real.com/found"),
  ]);

  const answer =
    "See [the real page](https://real.com/found) and [a made-up one](https://fake.com/nope).";

  const cleaned = keepKnownLinks(answer, allowed);

  // The real one stays a link.
  assert.match(
    cleaned,
    /\[the real page\]\(https:\/\/real\.com\/found\)/
  );

  // The invented one keeps its words but loses the link.
  assert.match(cleaned, /a made-up one/);
  assert.doesNotMatch(cleaned, /fake\.com/);
});


test("a bare invented url is de-linked, a real one kept", () => {
  const allowed = new Set([
    normalizeUrl("https://real.com/x"),
  ]);

  const cleaned = keepKnownLinks(
    "Source: https://real.com/x — not https://invented.com/y",
    allowed
  );

  assert.match(cleaned, /https:\/\/real\.com\/x/);
  // The invented bare url is wrapped so it is not a
  // broken clickable link.
  assert.match(cleaned, /`https:\/\/invented\.com\/y`/);
});


test("a real domain is kept even if the path differs from the search hit", () => {
  // The search returned the homepage; the model links a
  // deeper page on the same site. That is a real link and
  // must survive - exact matching used to wrongly strip it.
  const allowed = new Set(
    collectUrls("result: https://en.wikipedia.org/wiki/Einstein")
  );

  const cleaned = keepKnownLinks(
    "See [his relativity paper](https://en.wikipedia.org/wiki/Annus_Mirabilis_papers).",
    allowed
  );

  assert.match(cleaned, /\]\(https:\/\/en\.wikipedia\.org/);
  assert.doesNotMatch(cleaned, /`/);
});


test("a url shown inside code is never touched", () => {
  const cleaned = keepKnownLinks(
    "Run `curl https://anything.com/api` please",
    new Set()
  );

  assert.equal(
    cleaned,
    "Run `curl https://anything.com/api` please"
  );
});


test("a real link the model copied exactly survives", () => {
  const allowed = new Set(
    collectUrls(
      "result: https://docs.example.com/guide?v=2"
    )
  );

  const cleaned = keepKnownLinks(
    "Here: https://docs.example.com/guide?v=2",
    allowed
  );

  assert.match(
    cleaned,
    /https:\/\/docs\.example\.com\/guide\?v=2/
  );
  assert.doesNotMatch(cleaned, /`/);
});
