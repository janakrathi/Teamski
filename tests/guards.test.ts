import { test } from "node:test";

import assert from "node:assert/strict";

import path from "node:path";

import {
  WORKSPACE_FOLDER,
  projectFolder,
  resolveSafePath,
  spreadsheetId,
} from "../lib/ai/tools.ts";

const PROJECT = "3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const OTHER = "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b";

import { checkUrl, isPrivateAddress } from "../lib/ai/web.ts";


// checkUrl answers with a parsed URL or a reason
// it will not open one. Allowed means there is a
// URL to fetch.

function allowed(raw: string) {
  return checkUrl(raw).url !== null;
}

import { repoPath } from "../lib/connections/github.ts";


// ==========================================
// THE TWO GUARDS THAT MATTER
// ==========================================
//
// Everything else in this app fails visibly. If
// the composer breaks, somebody notices in a
// second.
//
// These two fail silently and expensively. A
// filename the model chose escaping agent-files
// means it can read .env.local. A URL the model
// chose reaching 169.254.169.254 means it can
// read cloud credentials. Both are one careless
// refactor away, and neither would look wrong in
// a diff.
//
// So they are pure functions, and these are the
// cases they have to keep getting right.
//


// ------------------------------------------
// STAYING INSIDE agent-files
// ------------------------------------------

test("ordinary filenames resolve inside the folder", () => {
  for (const name of [
    "notes.md",
    "sub/dir/notes.md",
    "a.b.c.txt",
    "with space.txt",
  ]) {
    const resolved = resolveSafePath(name, PROJECT);

    assert.ok(
      resolved.startsWith(
        path.resolve(projectFolder(PROJECT)) + path.sep
      ),
      `${name} should stay inside the project's folder`
    );
  }
});


test("climbing out of the folder is refused", () => {
  const attempts = [
    "../secrets.txt",
    "../../.env.local",
    "sub/../../.env.local",
    "./../../etc/passwd",
    "..\\\\..\\\\.env.local",

    // Absolute paths ignore the base entirely,
    // which is exactly why they have to be
    // caught rather than joined.
    "/etc/passwd",
    "C:\\\\Windows\\\\System32\\\\config\\\\SAM",
  ];

  for (const name of attempts) {
    assert.throws(
      () => resolveSafePath(name, PROJECT),
      `${name} should not resolve`
    );
  }
});


test("one project cannot reach another project's files", () => {
  for (const name of [
    `../${OTHER}/notes.md`,
    `../../projects/${OTHER}/notes.md`,
    "../notes.md",
    "..",
    ".",
  ]) {
    assert.throws(
      () => resolveSafePath(name, PROJECT),
      `${name} should not resolve`
    );
  }

  assert.notEqual(
    path.dirname(resolveSafePath("notes.md", PROJECT)),
    path.dirname(resolveSafePath("notes.md", OTHER))
  );
});


test("without a real project there are no files at all", () => {
  for (const projectId of [undefined, null, "", "..", "../../etc", "not-a-uuid"]) {
    assert.throws(
      () => resolveSafePath("notes.md", projectId as string),
      `${String(projectId)} should not be a folder`
    );
  }

  // The old shared folder itself is not reachable.
  assert.ok(
    !path.resolve(projectFolder(PROJECT)).startsWith(
      path.resolve(WORKSPACE_FOLDER, "notes.md")
    )
  );
});


test("an empty filename is refused", () => {
  for (const name of ["", "   "]) {
    assert.throws(() => resolveSafePath(name, PROJECT));
  }
});


// ------------------------------------------
// NOT FETCHING THE INSIDE OF THE NETWORK
// ------------------------------------------
//
// A page the model decides to read is a request
// this server makes from inside the network, so
// the interesting targets are the ones only this
// server can reach.
//

test("public addresses are allowed", () => {
  for (const url of [
    "https://example.com",
    "http://example.com/page?q=1",
    "https://sub.domain.example.co.uk/a/b",
  ]) {
    assert.equal(
      allowed(url),
      true,
      `${url} should be allowed`
    );
  }
});


test("the machine itself is refused", () => {
  for (const url of [
    "http://localhost:3000",
    "http://127.0.0.1",
    "http://127.0.0.1:11434/api/tags",
    "http://[::1]:3000",
    "http://0.0.0.0",
  ]) {
    assert.equal(
      allowed(url),
      false,
      `${url} should be refused`
    );
  }
});


test("private ranges are refused", () => {
  for (const url of [
    "http://10.0.0.5",
    "http://192.168.1.1",
    "http://172.16.0.1",
    "http://172.31.255.255",
    "http://[fd00::1]",
    "http://[fc00::1]",
    "http://[fe80::1]",
  ]) {
    assert.equal(
      allowed(url),
      false,
      `${url} should be refused`
    );
  }
});


test("a domain that merely starts with fd is fine", () => {
  // The old check was startsWith("fd") on the raw
  // hostname, which would have refused these.

  for (const url of [
    "https://fdn.com",
    "https://fcbarcelona.com",
    "https://fdic.gov",
  ]) {
    assert.equal(
      allowed(url),
      true,
      `${url} is a domain, not an IPv6 address`
    );
  }
});


test("the cloud metadata address is refused", () => {
  // The one that turns "read this page" into
  // "hand over the server's credentials".

  assert.equal(
    allowed(
      "http://169.254.169.254/latest/meta-data/"
    ),
    false
  );
});


test("IPv4 written inside IPv6 is refused", () => {
  // URL turns [::ffff:127.0.0.1] into
  // [::ffff:7f00:1], which the old check let
  // through as an ordinary IPv6 address.

  for (const url of [
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:7f00:1]:11434/api/tags",
    "http://[::ffff:169.254.169.254]/",
  ]) {
    assert.equal(allowed(url), false, url);
  }
});


test("what a name resolves to is checked too", () => {
  // checkUrlResolved looks the name up and runs
  // every address through this.

  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "100.64.0.1",
    "172.20.0.5",
    "192.168.1.1",
    "169.254.169.254",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "::ffff:10.0.0.1",
  ]) {
    assert.equal(isPrivateAddress(address), true, address);
  }

  for (const address of [
    "8.8.8.8",
    "104.16.1.1",
    "2606:4700::1111",
  ]) {
    assert.equal(isPrivateAddress(address), false, address);
  }
});


test("non-http schemes are refused", () => {
  for (const url of [
    "file:///etc/passwd",
    "ftp://example.com",
    "gopher://example.com",
    "data:text/html,hello",
    "not a url at all",
  ]) {
    assert.equal(
      allowed(url),
      false,
      `${url} should be refused`
    );
  }
});


// ------------------------------------------
// READING WHAT PEOPLE PASTE
// ------------------------------------------
//
// Not security, but the difference between a
// tool that works and one that needs a person to
// dig an id out of a URL by hand.
//

test("a spreadsheet id is found in a pasted URL", () => {
  assert.equal(
    spreadsheetId(
      "https://docs.google.com/spreadsheets/d/1AbC-dEf_2/edit#gid=0"
    ),
    "1AbC-dEf_2"
  );

  // Already an id, left alone.

  assert.equal(
    spreadsheetId("1AbC-dEf_2"),
    "1AbC-dEf_2"
  );
});


test("a repo is found however it was written", () => {
  for (const written of [
    "vercel/next.js",
    "https://github.com/vercel/next.js",
    "https://github.com/vercel/next.js.git",
    "  vercel/next.js  ",
  ]) {
    assert.equal(
      repoPath(written),
      "vercel/next.js",
      `${written} should read as vercel/next.js`
    );
  }
});


// ==========================================
// FILES THE AGENT SAVES
// ==========================================

import { prepareFileContent } from "../lib/ai/tools.ts";


test("an empty file is refused, not saved as 'created'", () => {
  assert.throws(() => prepareFileContent("landing.html", ""), /Nothing was saved/);
  assert.throws(() => prepareFileContent("notes.md", "   \n "), /Nothing was saved/);
  assert.throws(() => prepareFileContent("notes.md", undefined), /Nothing was saved/);
});


test("a page wrapped in a code fence is unwrapped", () => {
  const { content } = prepareFileContent(
    "landing.html",
    "```html\n<!doctype html><html><body>Hi</body></html>\n```"
  );

  assert.equal(content, "<!doctype html><html><body>Hi</body></html>");
});


test("an .html file must contain HTML", () => {
  assert.throws(() => prepareFileContent("landing.html", "Here is your landing page!"), /no HTML/);

  // Other files can be plain text.
  assert.equal(prepareFileContent("notes.md", "just text").content, "just text");
});


test("a page cut off part-way is saved, with a warning for the agent", () => {
  const { note } = prepareFileContent("landing.html", "<!doctype html><html><body><h1>Crochet");

  assert.match(note, /cut off/);

  assert.equal(prepareFileContent("landing.html", "<html><body>ok</body></html>").note, "");
});
