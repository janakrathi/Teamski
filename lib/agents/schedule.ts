// ==========================================
// WHEN A SCHEDULED AGENT RUNS
// ==========================================
//
// A schedule is a channel's agent doing a task on
// its own at a set time: "every Monday at 9,
// summarise last week in #general". The worker
// starts it; this file only answers "when next?"
// and "how do we say that in words?".
//
// Times are wall-clock times in the schedule's
// own timezone, so "9:00 in Kolkata" stays 9:00
// for the person who set it, whatever the server
// runs on. Pure, no database, so it can be tested
// on its own.
//

export type Cadence = "daily" | "weekdays" | "weekly" | "monthly";

export const CADENCES: Cadence[] = ["daily", "weekdays", "weekly", "monthly"];

export type ScheduleTiming = {
  cadence: Cadence;

  // "09:00", 24-hour.
  timeOfDay: string;

  // 0 Sunday .. 6 Saturday, for weekly.
  weekday?: number | null;

  // 1..28, for monthly - no month is short of it.
  monthDay?: number | null;

  // IANA name, "Asia/Kolkata".
  timezone: string;
};

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];


export function isValidTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });

    return true;
  } catch {
    return false;
  }
}


// What is wrong with a timing, in words, or null.

export function checkTiming(timing: Partial<ScheduleTiming>) {
  if (!timing.cadence || !CADENCES.includes(timing.cadence)) {
    return "Choose how often: every day, every weekday, weekly or monthly.";
  }

  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timing.timeOfDay ?? "")) {
    return "Choose a time, like 09:00.";
  }

  if (
    timing.cadence === "weekly" &&
    !(Number.isInteger(timing.weekday) && timing.weekday! >= 0 && timing.weekday! <= 6)
  ) {
    return "Choose a day of the week.";
  }

  if (
    timing.cadence === "monthly" &&
    !(Number.isInteger(timing.monthDay) && timing.monthDay! >= 1 && timing.monthDay! <= 28)
  ) {
    return "Choose a day of the month from 1 to 28.";
  }

  if (!timing.timezone || !isValidTimezone(timing.timezone)) {
    return "That timezone is not recognised.";
  }

  return null;
}


// The wall-clock date and time in a timezone.

function partsIn(instant: number, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value])
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}


// The instant a wall-clock time happens in a
// timezone. Found by guessing it as UTC, then
// correcting by the zone's offset at that moment -
// twice, so a daylight saving change in between
// still lands right.

function instantOf(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string
) {
  const wall = Date.UTC(year, month - 1, day, hour, minute);

  let guess = wall;

  for (let pass = 0; pass < 2; pass++) {
    const seen = partsIn(guess, timezone);

    const seenAsUtc = Date.UTC(
      seen.year,
      seen.month - 1,
      seen.day,
      seen.hour,
      seen.minute,
      seen.second
    );

    guess += wall - seenAsUtc;
  }

  return guess;
}


function matches(timing: ScheduleTiming, year: number, month: number, day: number) {
  // Day of the week of a calendar date, which does
  // not depend on any timezone.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  switch (timing.cadence) {
    case "daily":
      return true;
    case "weekdays":
      return weekday >= 1 && weekday <= 5;
    case "weekly":
      return weekday === timing.weekday;
    case "monthly":
      return day === timing.monthDay;
  }
}


// The first time strictly after `after` that the
// schedule should run.

export function nextRunAt(timing: ScheduleTiming, after: Date = new Date()) {
  const [hour, minute] = timing.timeOfDay.split(":").map(Number);

  const start = partsIn(after.getTime(), timing.timezone);

  // Walk forward a day at a time from today in the
  // schedule's zone. Monthly needs at most ~31
  // days; 62 leaves room.

  for (let offset = 0; offset < 62; offset++) {
    const date = new Date(Date.UTC(start.year, start.month - 1, start.day + offset));

    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();

    if (!matches(timing, year, month, day)) {
      continue;
    }

    const at = instantOf(year, month, day, hour, minute, timing.timezone);

    if (at > after.getTime()) {
      return new Date(at);
    }
  }

  throw new Error("No next run found for this schedule.");
}


// "Every weekday at 9:00 AM".

export function describeTiming(timing: ScheduleTiming) {
  const [hour, minute] = timing.timeOfDay.split(":").map(Number);

  const time = `${((hour + 11) % 12) + 1}:${String(minute).padStart(2, "0")} ${
    hour < 12 ? "AM" : "PM"
  }`;

  switch (timing.cadence) {
    case "daily":
      return `Every day at ${time}`;
    case "weekdays":
      return `Every weekday at ${time}`;
    case "weekly":
      return `Every ${WEEKDAYS[timing.weekday ?? 1]} at ${time}`;
    case "monthly":
      return `Monthly on the ${ordinal(timing.monthDay ?? 1)} at ${time}`;
  }
}


function ordinal(n: number) {
  const tens = n % 100;

  if (tens >= 11 && tens <= 13) {
    return `${n}th`;
  }

  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}


// Ready-made tasks for the new schedule form.

export const SCHEDULE_IDEAS: { title: string; task: string; timing: Partial<ScheduleTiming> }[] = [
  {
    title: "Weekly summary",
    task: "Summarise what this channel discussed and decided over the past week. List open questions and who owes what.",
    timing: { cadence: "weekly", weekday: 1, timeOfDay: "09:00" },
  },
  {
    title: "Daily digest",
    task: "Write a short digest of yesterday's messages in this channel: decisions, tasks and anything waiting on someone.",
    timing: { cadence: "weekdays", timeOfDay: "09:30" },
  },
  {
    title: "Friday wrap-up",
    task: "Wrap up the week: what got done, what slipped, and the three most important things for next week.",
    timing: { cadence: "weekly", weekday: 5, timeOfDay: "17:00" },
  },
  {
    title: "Morning news",
    task: "Search the web for today's most important news about our project's topic and summarise the top five items with links.",
    timing: { cadence: "daily", timeOfDay: "08:00" },
  },
];
