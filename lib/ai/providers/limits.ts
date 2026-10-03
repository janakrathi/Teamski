// ==========================================
// KEYS AND THEIR LIMITS
// ==========================================
//
// Pure helpers about provider rate limits, kept
// apart so they can be tested without loading
// any provider SDK.
//


// Whether a provider refused a request for being
// over its limit. OpenAI's SDK carries the status;
// other paths only have the message.

export function isRateLimited(error: unknown) {
  const status = (error as { status?: number } | null)?.status;

  if (status === 429) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error ?? "");

  return /\b429\b|RESOURCE_EXHAUSTED|rate.?limit|quota/i.test(message);
}


// Reads the first chunk of a provider's stream.
// A limit refusal arrives there, before any word,
// so it can still be swapped for another answer:
// null means "limited". Otherwise the stream comes
// back whole, first chunk included.

export async function unlessLimited<T>(
  stream: AsyncGenerator<T>
): Promise<AsyncGenerator<T> | null> {
  let first: IteratorResult<T>;

  try {
    first = await stream.next();
  } catch (error) {
    if (isRateLimited(error)) {
      return null;
    }

    throw error;
  }

  return (async function* () {
    if (!first.done) {
      yield first.value;
    }

    yield* stream;
  })();
}


// Google's quotas reset at midnight Pacific time,
// so "today" for a Gemini key starts there, not
// at midnight wherever the person is.

export function pacificDayStart(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value])
  );

  // How far Pacific time is behind UTC right now.
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  const offset = asUtc - Math.floor(now.getTime() / 1000) * 1000;

  const midnightAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day)
  );

  return new Date(midnightAsUtc - offset);
}


// Roughly how many requests a recorded turn made:
// one to start, and one more after each round of
// tool calls.

export function requestsFor(turns: { tool_calls: number | null }[]) {
  return turns.reduce(
    (total, turn) => total + 1 + Math.max(0, turn.tool_calls ?? 0),
    0
  );
}


// Today's requests on each model of one service,
// by bare model id ("gemini-3.8-flash"), from the
// recorded turns' "google/gemini-3.8-flash".

export function requestsByModel(
  turns: { model: string; tool_calls: number | null }[],
  service: string
) {
  const byModel: Record<string, number> = {};
  const prefix = `${service}/`;

  for (const turn of turns) {
    if (!turn.model.startsWith(prefix)) {
      continue;
    }

    const id = turn.model.slice(prefix.length);

    byModel[id] = (byModel[id] ?? 0) + requestsFor([turn]);
  }

  return byModel;
}


// When the chosen model is over its limit, which
// of the key's other models to try, in order.
//
// Models already used up today (by Teamski's own
// count, against the limit the person entered)
// are skipped. The rest go most-room-left first,
// then the ones with no limit entered, in the
// order the key lists them.

export function fallbackOrder(options: {
  chosen: string;
  models: string[];
  used: Record<string, number>;
  limits: Record<string, number>;
}) {
  const known: { id: string; left: number }[] = [];
  const unknown: string[] = [];

  for (const id of options.models) {
    if (id === options.chosen) {
      continue;
    }

    const limit = options.limits[id];

    if (!limit) {
      unknown.push(id);
      continue;
    }

    const left = limit - (options.used[id] ?? 0);

    if (left > 0) {
      known.push({ id, left });
    }
  }

  return [
    ...known.sort((a, b) => b.left - a.left).map((entry) => entry.id),
    ...unknown,
  ];
}


// ==========================================
// ROTATING ACROSS SOMEONE'S KEYS
// ==========================================
//
// "Rotate my keys" tries a person's own keys in turn -
// free-tier providers first - and moves on when one is
// over its limit or failing, the way a free-tier
// gateway like OmniRoute does, but inside Teamski. A
// key that let us down is rested for a while so every
// turn doesn't wait on it again.

// A key that can't answer right now: over its limit,
// or nothing usable behind it. The rotation moves on.
export class KeyUnavailable extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "KeyUnavailable";
  }
}

// The order to try services in: free tiers first, paid
// last, anything else in between.
const FREE_FIRST = ["groq", "cerebras", "google", "openrouter", "mistral", "nvidia", "github"];
const PAID_LAST = ["anthropic", "openai"];

export function rotationOrder(services: string[]) {
  const rank = (service: string) => {
    const free = FREE_FIRST.indexOf(service);

    if (free !== -1) {
      return free;
    }

    const paid = PAID_LAST.indexOf(service);

    return paid === -1 ? FREE_FIRST.length : FREE_FIRST.length + 1 + paid;
  };

  return [...new Set(services)].sort((a, b) => rank(a) - rank(b));
}

const resting = new Map<string, { until: number; strikes: number }>();

export function keyResting(id: string, now = Date.now()) {
  return (resting.get(id)?.until ?? 0) > now;
}

// Over its limit: a few minutes, growing with repeat
// misses. Failing for another reason (a bad key, a
// provider asking for billing): longer.
export function restKey(id: string, limited: boolean, now = Date.now()) {
  const strikes = (resting.get(id)?.strikes ?? 0) + 1;

  const minutes = Math.min(60, (limited ? 2 : 15) * 2 ** (strikes - 1));

  resting.set(id, { until: now + minutes * 60_000, strikes });
}

export function keyRecovered(id: string) {
  resting.delete(id);
}

export function __resetRotation() {
  resting.clear();
}
