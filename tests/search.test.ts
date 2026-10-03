import { test, beforeEach } from "node:test";

import assert from "node:assert/strict";

import {
  __reset,
  __setProviders,
  parseDuckDuckGoHtml,
  parseDuckDuckGoLite,
  search,
  tidyResults,
  type SearchResult,
} from "../lib/ai/search.ts";


const ONE: SearchResult[] = [
  { title: "Teamski", url: "https://teamski.in/", snippet: "Shared AI agents" },
];

function source(id: string, run: () => Promise<SearchResult[]>, enabled = true) {
  let calls = 0;

  return {
    id,
    enabled: () => enabled,
    run: async () => {
      calls++;

      return run();
    },
    get calls() {
      return calls;
    },
  };
}

beforeEach(() => __reset());


test("the first source that answers wins, in order", async () => {
  const first = source("first", async () => ONE);
  const second = source("second", async () => ONE);

  __setProviders([first, second]);

  const outcome = await search("teamski");

  assert.ok(outcome.ok);
  assert.equal(outcome.ok && outcome.source, "first");
  assert.equal(second.calls, 0);
});


test("a source without a key is never tried", async () => {
  const keyless = source("paid", async () => ONE, false);
  const free = source("free", async () => ONE);

  __setProviders([keyless, free]);

  const outcome = await search("teamski");

  assert.equal(outcome.ok && outcome.source, "free");
  assert.equal(keyless.calls, 0);
});


test("a failing source falls through to the next, then rests", async () => {
  const broken = source("broken", async () => {
    throw new Error("down");
  });
  const backup = source("backup", async () => ONE);

  __setProviders([broken, backup]);

  assert.equal((await search("first query")).ok, true);
  assert.equal(broken.calls, 1);

  // Resting: the next search does not wait on it again.
  await search("second query");
  assert.equal(broken.calls, 1);
  assert.equal(backup.calls, 2);
});


test("if every source is resting, they are still tried rather than giving up", async () => {
  let fail = true;

  const only = source("only", async () => {
    if (fail) {
      throw new Error("down");
    }

    return ONE;
  });

  __setProviders([only]);

  assert.equal((await search("a")).ok, false);

  fail = false;

  assert.equal((await search("b")).ok, true);
});


test("the same search is answered from memory, however it was typed", async () => {
  const counted = source("counted", async () => ONE);

  __setProviders([counted]);

  await search("Best CRM for agencies", { region: "IN" });
  await search("  best crm   for AGENCIES ", { region: "in" });

  assert.equal(counted.calls, 1);

  // A different country is a different search.
  await search("best crm for agencies", { region: "us" });
  assert.equal(counted.calls, 2);
});


test("an empty page from a scraped source lets the next source try", async () => {
  const scraped = source("duckduckgo", async () => []);
  const paid = source("backup", async () => ONE);

  __setProviders([scraped, paid]);

  const outcome = await search("teamski");

  assert.equal(outcome.ok && outcome.source, "backup");
});


test("when nothing anywhere matches, that is an answer, not an error", async () => {
  __setProviders([source("duckduckgo", async () => [])]);

  const outcome = await search("zzqx nonsense");

  assert.ok(outcome.ok);
  assert.equal(outcome.ok && outcome.results.length, 0);
});


test("results are deduplicated, cleaned and capped", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    title: `Result ${i}`,
    url: `https://example.com/page-${i}`,
    snippet: "",
  }));

  const tidy = tidyResults([
    { title: "A", url: "https://www.example.com/a/?utm_source=x", snippet: "" },
    { title: "A again", url: "https://example.com/a", snippet: "" },
    { title: "No link", url: "javascript:alert(1)", snippet: "" },
    { title: "", url: "https://example.com/untitled", snippet: "" },
    ...many,
  ]);

  assert.equal(tidy[0].title, "A");
  assert.ok(!tidy.some((r) => r.title === "A again"));
  assert.ok(!tidy.some((r) => r.url.startsWith("javascript")));
  assert.equal(tidy.length, 8);
});


test("DuckDuckGo's HTML page is read, including wrapped links", () => {
  const html = `
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fteamski.in%2F&amp;rut=x">Teamski <b>AI</b></a>
    <a class="result__snippet" href="#">Shared &amp; open-source agents</a>
    <a rel="nofollow" class="result__a" href="https://example.com/b">Second</a>`;

  const results = parseDuckDuckGoHtml(html);

  assert.equal(results.length, 2);
  assert.equal(results[0].url, "https://teamski.in/");
  assert.equal(results[0].title, "Teamski AI");
  assert.equal(results[0].snippet, "Shared & open-source agents");
});


test("DuckDuckGo's lite page is read", () => {
  const html = `
    <tr><td><a rel="nofollow" href="https://teamski.in/" class='result-link'>Teamski</a></td></tr>
    <tr><td class='result-snippet'>One AI agent per channel.</td></tr>`;

  const results = parseDuckDuckGoLite(html);

  assert.equal(results.length, 1);
  assert.equal(results[0].url, "https://teamski.in/");
  assert.equal(results[0].snippet, "One AI agent per channel.");
});


test("a bot-check page counts as a refusal, not as no results", () => {
  const blocked = `<html><div class="anomaly-modal">Unfortunately, bots use DuckDuckGo too.</div></html>`;

  assert.throws(() => parseDuckDuckGoHtml(blocked));
  assert.throws(() => parseDuckDuckGoLite(blocked));

  // An ordinary empty page is just empty.
  assert.deepEqual(parseDuckDuckGoHtml("<html>No results.</html>"), []);
});
