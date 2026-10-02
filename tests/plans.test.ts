import { test } from "node:test";

import assert from "node:assert/strict";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DAILY_MESSAGES,
  DailyLimitError,
  SELF_HOSTED,
  dailyLimit,
  allows,
  builtinAllowed,
  can,
  teamMonthlyPrice,
  teamMonthlyPriceINR,
  formatMoney,
  currencyForCountry,
  countryFromZone,
  ownKeyAllowed,
  planForModel,
  planOf,
} from "../lib/plans.ts";


test("project roles: who may do what", () => {
  // The owner can do everything, billing and
  // deleting included.
  assert.equal(can("owner", "manage_billing"), true);
  assert.equal(can("owner", "delete_project"), true);
  assert.equal(can("owner", "manage_members"), true);

  // An admin runs the project but not its money or
  // its existence.
  assert.equal(can("admin", "manage_members"), true);
  assert.equal(can("admin", "manage_settings"), true);
  assert.equal(can("admin", "manage_billing"), false);
  assert.equal(can("admin", "delete_project"), false);
  assert.equal(
    can("admin", "transfer_ownership"),
    false
  );

  // A member only uses the project.
  assert.equal(can("member", "use"), true);
  assert.equal(can("member", "manage_members"), false);
  assert.equal(can("member", "manage_settings"), false);

  // Not a member: nothing.
  assert.equal(can(null, "use"), false);
});


// A stand-in for the one query planOf makes.

function fakeDb(result: {
  data: unknown;
  error: unknown;
}) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => result,
  };

  return {
    from: () => chain,
  } as unknown as SupabaseClient;
}


test("keys, shared keys, apps and the spend report all come with Team", () => {
  for (const feature of [
    "own_keys",
    "shared_keys",
    "spend_report",
    "apps",
    "custom_apps",
  ] as const) {
    assert.equal(allows("free", feature), false, feature);
    assert.equal(allows("team", feature), true, feature);
  }
});


test("Team gets a better built-in model than Free", () => {
  // The machine's default model is basic, and
  // everyone has it.
  assert.equal(builtinAllowed("free", "qwen3:1.7b"), true);

  assert.equal(builtinAllowed("free", "qwen3:4b"), false);
  assert.equal(builtinAllowed("team", "qwen3:4b"), true);

  // Paid hosted models are never handed out
  // built-in on any plan - they are reached only
  // with your own key.
  assert.equal(
    builtinAllowed("team", "anthropic/claude-sonnet-5"),
    false
  );
  assert.equal(
    builtinAllowed("team", "anthropic/claude-opus-5"),
    false
  );

  // Groq's shared free-tier models are the one
  // hosted exception: basic, so the Free plan
  // (and every plan) hands them out.
  assert.equal(
    builtinAllowed("free", "groq/openai/gpt-oss-120b"),
    true
  );
  assert.equal(
    builtinAllowed("free", "groq/openai/gpt-oss-20b"),
    true
  );
  assert.equal(
    planForModel("groq/openai/gpt-oss-120b"),
    "free"
  );

  // Cerebras's shared free models are the same
  // basic tier as Groq's.
  assert.equal(
    builtinAllowed("free", "cerebras/gpt-oss-120b"),
    true
  );
  assert.equal(
    builtinAllowed("free", "cerebras/qwen-3.8-27b"),
    true
  );

  assert.equal(planForModel("qwen3:4b"), "team");

  // No plan hands out a "best" hosted model built
  // in, so there is no plan for it.
  assert.equal(planForModel("openai/gpt-4.1"), null);
});


test("Team gets more messages than Free", () => {
  assert.ok(DAILY_MESSAGES.free < DAILY_MESSAGES.team);

  assert.match(new DailyLimitError("free").message, /Team/);

  // On the top plan there is no higher one to
  // point at.
  assert.match(new DailyLimitError("team").message, /resets/i);
});


test("teamski.in is not self-hosted, and keeps its daily allowances", () => {
  // These tests run without NEXT_PUBLIC_SELF_HOSTED;
  // tests/self-hosted.test.ts covers the other side.
  assert.equal(SELF_HOSTED, false);

  assert.equal(dailyLimit("free"), DAILY_MESSAGES.free);
  assert.equal(dailyLimit("team"), DAILY_MESSAGES.team);
});


test("no row, no table, or no user is free", async () => {
  assert.equal(
    await planOf(fakeDb({ data: null, error: null }), "u"),
    "free"
  );

  assert.equal(
    await planOf(
      fakeDb({
        data: null,
        error: { code: "42P01" },
      }),
      "u"
    ),
    "free"
  );

  assert.equal(await planOf(null, "u"), "free");
});


test("a paid plan counts until it runs out", async () => {
  const future = new Date(
    Date.now() + 86_400_000
  ).toISOString();

  const past = new Date(
    Date.now() - 86_400_000
  ).toISOString();

  assert.equal(
    await planOf(
      fakeDb({
        data: { plan: "team", current_period_end: future },
        error: null,
      }),
      "u"
    ),
    "team"
  );

  assert.equal(
    await planOf(
      fakeDb({
        data: { plan: "team", current_period_end: past },
        error: null,
      }),
      "u"
    ),
    "free"
  );
});


test("an unknown or retired plan name is free", async () => {
  assert.equal(
    await planOf(
      fakeDb({
        data: { plan: "pro", current_period_end: null },
        error: null,
      }),
      "u"
    ),
    "free"
  );
});


test("a free Gemini key works on every plan; other keys need Team", () => {
  assert.equal(ownKeyAllowed("free", "google"), true);
  assert.equal(ownKeyAllowed("free", "anthropic"), false);
  assert.equal(ownKeyAllowed("free", "openrouter"), false);
  assert.equal(ownKeyAllowed("team", "anthropic"), true);
  assert.equal(ownKeyAllowed("team", "google"), true);

  // Sharing a key with the project is still a
  // paid feature, Gemini or not.
  assert.equal(allows("free", "shared_keys"), false);
});


test("Team's price covers five, then charges per extra teammate", () => {
  assert.equal(teamMonthlyPrice(1, "INR"), 549);
  assert.equal(teamMonthlyPrice(5, "INR"), 549);
  assert.equal(teamMonthlyPrice(6, "INR"), 674);
  assert.equal(teamMonthlyPrice(8, "INR"), 549 + 3 * 125);
});


test("dollar pricing is its own numbers, not a rupee conversion", () => {
  assert.equal(teamMonthlyPrice(5, "USD"), 19);
  assert.equal(teamMonthlyPrice(6, "USD"), 23);
  assert.equal(teamMonthlyPrice(5, "INR"), 549);
  assert.equal(formatMoney("USD", 19), "$19");
  assert.equal(formatMoney("INR", 549), "₹549");
});


test("a foreign price is charged as a rupee amount", () => {
  // INR is charged as shown.
  assert.equal(teamMonthlyPriceINR(5, "INR"), 549);
  assert.equal(teamMonthlyPriceINR(6, "INR"), 674);

  // A dollar price is charged as its rupee amount,
  // and per extra seat too.
  assert.equal(teamMonthlyPriceINR(5, "USD"), 1599);
  assert.equal(
    teamMonthlyPriceINR(7, "USD"),
    1599 + 2 * 339
  );
});


test("currency is decided by country, and unknown places pay in dollars", () => {
  assert.equal(currencyForCountry("IN"), "INR");
  assert.equal(currencyForCountry("AE"), "AED");
  assert.equal(currencyForCountry("DE"), "EUR");
  assert.equal(currencyForCountry("FR"), "EUR");
  assert.equal(currencyForCountry("GB"), "GBP");
  assert.equal(currencyForCountry("SG"), "SGD");
  assert.equal(currencyForCountry("JP"), "USD");
  assert.equal(currencyForCountry(null), "USD");

  assert.equal(countryFromZone("Asia/Kolkata"), "IN");
  assert.equal(countryFromZone("Asia/Dubai"), "AE");
  assert.equal(countryFromZone("Australia/Sydney"), "AU");
  assert.equal(countryFromZone("America/New_York"), null);
});
