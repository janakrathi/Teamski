import { test } from "node:test";

import assert from "node:assert/strict";

import {
  checkTiming,
  describeTiming,
  nextRunAt,
} from "../lib/agents/schedule.ts";


const kolkata = "Asia/Kolkata";


test("daily: later today if the time has not passed, otherwise tomorrow", () => {
  // 14 Sep 2026, 08:00 in Kolkata (02:30 UTC).
  const morning = new Date("2026-09-14T02:30:00Z");

  assert.equal(
    nextRunAt({ cadence: "daily", timeOfDay: "09:00", timezone: kolkata }, morning).toISOString(),
    "2026-09-14T03:30:00.000Z"
  );

  // 10:00 in Kolkata: tomorrow at 9.
  const later = new Date("2026-09-14T04:30:00Z");

  assert.equal(
    nextRunAt({ cadence: "daily", timeOfDay: "09:00", timezone: kolkata }, later).toISOString(),
    "2026-09-15T03:30:00.000Z"
  );
});


test("exactly at the run time counts as passed, so a run is never repeated", () => {
  const at = new Date("2026-09-14T03:30:00Z");

  assert.equal(
    nextRunAt({ cadence: "daily", timeOfDay: "09:00", timezone: kolkata }, at).toISOString(),
    "2026-09-15T03:30:00.000Z"
  );
});


test("weekdays skip the weekend", () => {
  // Friday 18 Sep 2026, 18:00 Kolkata.
  const friday = new Date("2026-09-18T12:30:00Z");

  // Monday 21 Sep, 09:30 Kolkata.
  assert.equal(
    nextRunAt({ cadence: "weekdays", timeOfDay: "09:30", timezone: kolkata }, friday).toISOString(),
    "2026-09-21T04:00:00.000Z"
  );
});


test("weekly lands on the chosen day", () => {
  // Monday 14 Sep 2026 is day 1; ask for Friday (5) at 17:00.
  assert.equal(
    nextRunAt(
      { cadence: "weekly", weekday: 5, timeOfDay: "17:00", timezone: kolkata },
      new Date("2026-09-14T04:30:00Z")
    ).toISOString(),
    "2026-09-18T11:30:00.000Z"
  );
});


test("monthly moves to next month once this month's day has passed", () => {
  assert.equal(
    nextRunAt(
      { cadence: "monthly", monthDay: 1, timeOfDay: "10:00", timezone: kolkata },
      new Date("2026-09-14T04:30:00Z")
    ).toISOString(),
    "2026-10-01T04:30:00.000Z"
  );
});


test("a zone with daylight saving keeps the wall-clock time", () => {
  // New York: 9:00 is 13:00 UTC in summer (EDT) and 14:00 UTC in winter (EST).
  // Clocks go back on 1 Nov 2026.
  const ny = "America/New_York";

  assert.equal(
    nextRunAt({ cadence: "daily", timeOfDay: "09:00", timezone: ny }, new Date("2026-10-31T20:00:00Z")).toISOString(),
    "2026-11-01T14:00:00.000Z"
  );

  assert.equal(
    nextRunAt({ cadence: "daily", timeOfDay: "09:00", timezone: ny }, new Date("2026-10-30T20:00:00Z")).toISOString(),
    "2026-10-31T13:00:00.000Z"
  );
});


test("bad timings are refused in words", () => {
  assert.equal(checkTiming({ cadence: "daily", timeOfDay: "09:00", timezone: kolkata }), null);
  assert.match(checkTiming({ cadence: "hourly" as never, timeOfDay: "09:00", timezone: kolkata })!, /how often/);
  assert.match(checkTiming({ cadence: "daily", timeOfDay: "25:00", timezone: kolkata })!, /time/);
  assert.match(checkTiming({ cadence: "weekly", timeOfDay: "09:00", timezone: kolkata })!, /day of the week/);
  assert.match(checkTiming({ cadence: "monthly", monthDay: 31, timeOfDay: "09:00", timezone: kolkata })!, /1 to 28/);
  assert.match(checkTiming({ cadence: "daily", timeOfDay: "09:00", timezone: "Mars/Olympus" })!, /timezone/);
});


test("timings read as sentences", () => {
  assert.equal(describeTiming({ cadence: "weekdays", timeOfDay: "09:30", timezone: kolkata }), "Every weekday at 9:30 AM");
  assert.equal(describeTiming({ cadence: "weekly", weekday: 1, timeOfDay: "17:05", timezone: kolkata }), "Every Monday at 5:05 PM");
  assert.equal(describeTiming({ cadence: "monthly", monthDay: 22, timeOfDay: "00:00", timezone: kolkata }), "Monthly on the 22nd at 12:00 AM");
  assert.equal(describeTiming({ cadence: "daily", timeOfDay: "12:15", timezone: kolkata }), "Every day at 12:15 PM");
});
