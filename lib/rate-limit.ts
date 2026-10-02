// ==========================================
// RATE LIMITS
// ==========================================
//
// What stops one person - or one script - from
// filling the server's model queue, burning
// through a project's shared key, or mailing
// invites to a list of strangers.
//
// Counted per signed-in person where there is
// one, and per IP address otherwise. IP limits are
// deliberately loose: a whole college hostel can
// share one address, and those are real people.
//
// Kept in memory. Teamski runs as one process on
// one server, so one counter is the truth. Run a
// second copy of the app and each would count on
// its own - at that point this moves to a shared
// store.
//

export type Rule = {
  id: string;

  // Which requests it applies to.
  methods?: string[];
  path: RegExp;

  // How many requests, over how long.
  limit: number;
  windowMs: number;

  // Said to the person when they hit it.
  message: string;
};

const MINUTE = 60_000;


// First match wins, so the specific rules come
// before the general ones.

export const RULES: Rule[] = [
  {
    id: "chat",
    methods: ["POST"],
    path: /^\/api\/chat$/,
    limit: 20,
    windowMs: MINUTE,
    message: "You are sending messages to the agent very quickly. Wait a moment and try again.",
  },
  {
    id: "agent-runs",
    methods: ["POST"],
    path: /^\/api\/agents(\/[^/]+\/run)?$/,
    limit: 10,
    windowMs: MINUTE,
    message: "Too many agent tasks started at once. Wait a minute and try again.",
  },
  {
    id: "uploads",
    methods: ["POST"],
    path: /^\/api\/attachments$/,
    limit: 20,
    windowMs: MINUTE,
    message: "Too many uploads at once. Wait a minute and try again.",
  },
  {
    id: "invites",
    methods: ["POST"],
    path: /^\/api\/projects\/[^/]+\/members$/,
    limit: 20,
    windowMs: 10 * MINUTE,
    message: "Too many invites in a short time. Wait a few minutes and try again.",
  },
  {
    id: "keys",
    methods: ["POST"],
    path: /^\/api\/(models\/keys|projects\/[^/]+\/model-keys)$/,
    limit: 10,
    windowMs: 10 * MINUTE,
    message: "Too many attempts to add a key. Wait a few minutes and try again.",
  },
  {
    id: "apps",
    methods: ["POST", "PATCH"],
    path: /^\/api\/mcp$/,
    limit: 10,
    windowMs: MINUTE,
    message: "Too many connection attempts. Wait a minute and try again.",
  },
  {
    id: "connect",
    path: /^\/api\/connections\/(google|github)$/,
    limit: 10,
    windowMs: MINUTE,
    message: "Too many connection attempts. Wait a minute and try again.",
  },
  {
    id: "create",
    methods: ["POST"],
    path: /^\/api\/projects(\/[^/]+\/channels)?$/,
    limit: 20,
    windowMs: 10 * MINUTE,
    message: "Too many projects or channels created in a short time. Wait a few minutes.",
  },
  {
    id: "search",
    path: /^\/api\/search$/,
    limit: 30,
    windowMs: MINUTE,
    message: "Too many searches. Wait a moment and try again.",
  },
  {
    id: "messages",
    methods: ["POST", "PATCH", "DELETE"],
    path: /^\/api\/(projects\/[^/]+\/messages|dms\/[^/]+\/messages)$/,
    limit: 60,
    windowMs: MINUTE,
    message: "You are sending messages very quickly. Wait a moment.",
  },
  {
    id: "checkout",
    methods: ["POST"],
    path: /^\/api\/billing\/checkout$/,
    limit: 5,
    windowMs: MINUTE,
    message: "Too many checkout attempts. Wait a minute and try again.",
  },

  // A whole project at once is a heavy read; a few
  // in a row is plenty.
  {
    id: "export",
    methods: ["GET"],
    path: /^\/api\/projects\/[^/]+\/export$/,
    limit: 5,
    windowMs: 10 * MINUTE,
    message: "Too many exports in a short time. Wait a few minutes and try again.",
  },

  // The public Contact sales form. Anyone can reach
  // it signed out, so it is tight: a real person sends
  // one, maybe two.
  {
    id: "enterprise",
    methods: ["POST"],
    path: /^\/api\/enterprise$/,
    limit: 5,
    windowMs: 10 * MINUTE,
    message: "We've already got your message. If you need to add something, wait a few minutes and try again.",
  },

  // Everything else in the API. Generous, because
  // the app polls for unread counts and activity.
  {
    id: "api",
    path: /^\/api\//,
    limit: 300,
    windowMs: MINUTE,
    message: "Too many requests. Wait a moment and try again.",
  },
];


// Before anyone is known. Loose enough for a
// campus behind one address, tight enough to stop
// a flood.

export const IP_RULE: Rule = {
  id: "ip",
  path: /.*/,
  limit: 1200,
  windowMs: MINUTE,
  message: "Too many requests from your network. Wait a minute and try again.",
};


// The same check for requests that carry a sign-in.
// A hackathon venue, a college or an office puts
// hundreds of signed-in people behind one address, and
// each open tab checks in a few times a minute - under
// the rule above a room of sixty people locked itself
// out. Signed-in people are also limited one by one
// once they are known (RULES, per person), so this is
// only a ceiling on the address as a whole. A forged
// cookie buys nothing but this ceiling: it still fails
// sign-in, and the per-address API rules then apply.

export const SIGNED_IN_IP_RULE: Rule = {
  id: "ip-signed-in",
  path: /.*/,
  limit: 10_000,
  windowMs: MINUTE,
  message: "Too many requests from your network. Wait a minute and try again.",
};

// Supabase keeps a session in sb-<project>-auth-token,
// split into .0, .1 ... when it is long.
const SESSION_COOKIE = /(?:^|;\s*)sb-[^=;]+-auth-token(?:\.\d+)?=/;


// Which per-address rule a request falls under, from its
// cookies alone - decided before any call to Supabase.

export function floodRuleFor(cookieHeader: string | null) {
  return cookieHeader && SESSION_COOKIE.test(cookieHeader)
    ? SIGNED_IN_IP_RULE
    : IP_RULE;
}


export function ruleFor(method: string, path: string) {
  return RULES.find(
    (rule) =>
      rule.path.test(path) &&
      (!rule.methods || rule.methods.includes(method))
  );
}


// ------------------------------------------
// THE COUNTER
// ------------------------------------------
//
// A token bucket: full to start, refilled evenly
// over the window. Short bursts are fine; a steady
// stream above the limit is not.
//

type Bucket = { tokens: number; updated: number };

const MAX_BUCKETS = 50_000;


export function createLimiter(now: () => number = Date.now) {
  const buckets = new Map<string, Bucket>();

  function sweep(time: number) {
    // Full buckets carry no information, so they
    // are what gets dropped when memory grows.

    for (const [key, bucket] of buckets) {
      if (time - bucket.updated > 10 * MINUTE) {
        buckets.delete(key);
      }
    }

    if (buckets.size > MAX_BUCKETS) {
      buckets.clear();
    }
  }

  return function take(
    rule: Rule,
    who: string
  ): { ok: true } | { ok: false; retryAfterSeconds: number } {
    const time = now();

    if (buckets.size > MAX_BUCKETS) {
      sweep(time);
    }

    const key = `${rule.id}:${who}`;

    const rate = rule.limit / rule.windowMs;

    const bucket = buckets.get(key) ?? {
      tokens: rule.limit,
      updated: time,
    };

    bucket.tokens = Math.min(
      rule.limit,
      bucket.tokens + (time - bucket.updated) * rate
    );

    bucket.updated = time;

    buckets.set(key, bucket);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;

      return { ok: true };
    }

    return {
      ok: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((1 - bucket.tokens) / rate / 1000)
      ),
    };
  };
}


// The address the request came from. Behind Caddy
// the real one is the last entry it adds; anything
// earlier could have been typed by the client.

export function clientIp(headers: Headers) {
  const forwarded = headers.get("x-forwarded-for");

  if (forwarded) {
    const parts = forwarded
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  }

  return headers.get("x-real-ip") ?? "unknown";
}
