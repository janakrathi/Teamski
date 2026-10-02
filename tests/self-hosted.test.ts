import { test } from "node:test";

import assert from "node:assert/strict";


// The flag is read when the module loads, so it is
// set before the import. Each test file runs in its
// own process, so this never leaks into the others.

process.env.NEXT_PUBLIC_SELF_HOSTED = "true";

delete process.env.DAILY_MESSAGE_LIMIT;

delete process.env.SCHEDULES_PER_PROJECT;

const plans = await import("../lib/plans.ts");


test("a self-hosted copy knows it is one", () => {
  assert.equal(plans.SELF_HOSTED, true);
});


test("every person and project gets Team, with no database read", async () => {
  // No client at all: nothing is looked up.

  assert.equal(await plans.planOf(null, null), "team");

  const info = await plans.projectPlan(null, "any-project");

  assert.equal(info.plan, "team");
  assert.equal(info.provider, "self-hosted");
  assert.equal(info.currentPeriodEnd, null);

  assert.equal(await plans.projectOwnerPlan(null, "any-project"), "team");
});


test("every paid feature is included", () => {
  for (const feature of ["own_keys", "shared_keys", "spend_report", "apps", "custom_apps"] as const) {
    assert.equal(plans.allows("team", feature), true, feature);
  }
});


test("there is no daily cap unless the server sets one", () => {
  assert.equal(plans.dailyLimit("team"), null);

  process.env.DAILY_MESSAGE_LIMIT = "250";

  try {
    assert.equal(plans.dailyLimit("team"), 250);
    assert.equal(plans.dailyLimit("free"), 250);
  } finally {
    delete process.env.DAILY_MESSAGE_LIMIT;
  }

  // Nonsense is no cap, not a cap of zero.

  process.env.DAILY_MESSAGE_LIMIT = "lots";

  try {
    assert.equal(plans.dailyLimit("team"), null);
  } finally {
    delete process.env.DAILY_MESSAGE_LIMIT;
  }
});


test("schedules default to Team's number, or the server's own", () => {
  assert.equal(plans.schedulesLimit("team"), plans.SCHEDULES_PER_PROJECT.team);

  process.env.SCHEDULES_PER_PROJECT = "40";

  try {
    assert.equal(plans.schedulesLimit("team"), 40);
  } finally {
    delete process.env.SCHEDULES_PER_PROJECT;
  }
});


test("hitting a self-hosted cap never suggests buying anything", () => {
  process.env.DAILY_MESSAGE_LIMIT = "50";

  try {
    const message = new plans.DailyLimitError("team").message;

    assert.match(message, /50 built-in AI messages/);
    assert.doesNotMatch(message, /Team|Free|plan|owner/i);
  } finally {
    delete process.env.DAILY_MESSAGE_LIMIT;
  }
});
