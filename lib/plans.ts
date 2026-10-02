import type { SupabaseClient } from "@supabase/supabase-js";


// ==========================================
// WHAT EACH PLAN INCLUDES
// ==========================================
//
// This is a team product, so a plan belongs to a
// project rather than to a person: whoever owns
// the project pays, and everyone in it gets what
// that plan includes. Somebody's own plan only
// matters in the projects they own.
//
//   Free   - make projects, invite anyone, a basic
//            built-in model and a small daily
//            allowance. Bring a free Gemini key
//            for faster answers.
//   Team   - a faster built-in model, more
//            messages, your own or a shared API
//            key with a spend report, connected
//            apps, and more scheduled agents.
//
// One file, so moving a feature between plans or
// changing a number is one edit. Only list what
// the app actually does - a feature on the plan
// page that does not exist is a promise somebody
// paid for.
//
// A plan is only ever written by the server
// (payments, or by hand in the SQL editor until
// those exist). Row level security lets people
// read their own and write nothing.
//

export type Plan = "free" | "team";

export type Feature =
  | "own_keys"
  | "shared_keys"
  | "spend_report"
  | "apps"
  | "custom_apps";

const INCLUDED: Record<Feature, Plan[]> = {
  own_keys: ["team"],
  shared_keys: ["team"],
  spend_report: ["team"],

  // Apps over MCP from the app's own list, and
  // any MCP server by address.
  apps: ["team"],
  custom_apps: ["team"],
};

export const PLAN_LABELS: Record<Plan, string> = {
  free: "Free",
  team: "Team",
};

const RANK: Record<Plan, number> = {
  free: 0,
  team: 1,
};


// ------------------------------------------
// THE BUILT-IN MODEL
// ------------------------------------------
//
// "Built-in" is anything the person did not bring
// a key for: the machine's own models, or the
// server's hosted key. Those cost the platform,
// so they are what the plans ration - by how good
// a model you get, and by how many messages a day.
//
// Messages on your own key, or the project's
// shared key, are somebody else's bill and do not
// count.
//

export type Tier = "basic" | "standard" | "best";

const TIER_RANK: Record<Tier, number> = {
  basic: 0,
  standard: 1,
  best: 2,
};

export const PLAN_TIER: Record<Plan, Tier> = {
  free: "basic",
  team: "standard",
};

// Per person, per day, across every project -
// otherwise a second project is a second
// allowance. Placeholders until real usage says
// what they should be.

// Scheduled agents per project. A schedule runs on
// its own every day or week, so even one is the
// feature; more is what a team that relies on it
// pays for.

export const SCHEDULES_PER_PROJECT: Record<Plan, number> = {
  free: 1,
  team: 10,
};

// ------------------------------------------
// WHAT TEAM COSTS
// ------------------------------------------
//
// A project on Team pays a flat base that covers
// the first few people, then a little for each
// extra teammate. Kept here as numbers so the plan
// page, the billing calculation and any future
// change all read the same source.

// Regional pricing: each big market pays in its
// own currency, at a price set for that market -
// not a live exchange-rate conversion, so the
// numbers stay round and never drift. Everywhere
// else pays in dollars. Which currency a visitor
// sees is decided from where they are (their
// browser's region), not chosen from a menu, so
// nobody just picks the cheapest.
//
// Change a number here and the plan page, the
// billing maths and the tests all follow.

export const CURRENCIES = [
  "INR",
  "USD",
  "EUR",
  "GBP",
  "AED",
  "CAD",
  "AUD",
  "SGD",
] as const;

export type Currency = (typeof CURRENCIES)[number];

export const DEFAULT_CURRENCY: Currency = "USD";

// People the base price covers before the
// per-teammate part begins. Same everywhere.

export const INCLUDED_MEMBERS = 5;

// A new project starts on Team free for this long, then
// lapses to Free on its own. A launch promo, written as
// a normal subscription row (provider "promo") so it
// uses the same plan, reminders and expiry as a paid one.

export const TRIAL_DAYS = 60;

// Per month: what covers the first five people,
// and what each extra teammate adds.

export const TEAM_PRICE: Record<
  Currency,
  { base: number; perExtraMember: number }
> = {
  INR: { base: 549, perExtraMember: 125 },
  USD: { base: 19, perExtraMember: 4 },
  EUR: { base: 19, perExtraMember: 4 },
  GBP: { base: 15, perExtraMember: 3 },
  AED: { base: 69, perExtraMember: 15 },
  CAD: { base: 25, perExtraMember: 5 },
  AUD: { base: 29, perExtraMember: 6 },
  SGD: { base: 25, perExtraMember: 5 },
};

function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}


// What is actually charged, in rupees, for each
// currency's price. Payments run in INR only for
// now, so a foreign visitor sees their own price
// but is charged its rupee equivalent - hand-set
// like the prices themselves, not a live rate, so
// nothing moves on its own. Adjust these as the
// exchange rate drifts.

export const TEAM_PRICE_INR: Record<
  Currency,
  { base: number; perExtraMember: number }
> = {
  INR: { base: 549, perExtraMember: 125 },
  USD: { base: 1599, perExtraMember: 339 },
  EUR: { base: 1749, perExtraMember: 369 },
  GBP: { base: 1599, perExtraMember: 319 },
  AED: { base: 1575, perExtraMember: 345 },
  CAD: { base: 1549, perExtraMember: 309 },
  AUD: { base: 1599, perExtraMember: 329 },
  SGD: { base: 1575, perExtraMember: 315 },
};


// The monthly price for a project on Team with a
// given number of members, in a currency.

export function teamMonthlyPrice(
  members: number,
  currency: Currency = DEFAULT_CURRENCY
) {
  const price = TEAM_PRICE[currency];

  const extra = Math.max(0, Math.ceil(members) - INCLUDED_MEMBERS);

  return price.base + extra * price.perExtraMember;
}


// The same price, but in the rupees actually
// charged - what a Razorpay order is created for.

export function teamMonthlyPriceINR(
  members: number,
  currency: Currency = DEFAULT_CURRENCY
) {
  const price = TEAM_PRICE_INR[currency];

  const extra = Math.max(0, Math.ceil(members) - INCLUDED_MEMBERS);

  return price.base + extra * price.perExtraMember;
}


// "₹549", "$19", "€19", "AED 69" - whole numbers,
// the local symbol, from the browser's own
// formatter.

export function formatMoney(currency: Currency, amount: number) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}


// ------------------------------------------
// WHERE SOMEBODY IS -> WHICH CURRENCY
// ------------------------------------------
//
// From an ISO country code (IN, AE, DE...). The
// browser works out the country; this turns it
// into a price. Anywhere not listed pays in
// dollars.

const COUNTRY_CURRENCY: Record<string, Currency> = {
  IN: "INR",
  AE: "AED",
  GB: "GBP",
  CA: "CAD",
  AU: "AUD",
  NZ: "AUD",
  SG: "SGD",
  US: "USD",
};

// The euro countries.
for (const country of [
  "AT", "BE", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES",
]) {
  COUNTRY_CURRENCY[country] = "EUR";
}


export function currencyForCountry(
  country: string | null | undefined
): Currency {
  if (!country) {
    return DEFAULT_CURRENCY;
  }

  return COUNTRY_CURRENCY[country.toUpperCase()] ?? DEFAULT_CURRENCY;
}


// A few timezones pin the country better than a
// browser language ever could (an Indian phone set
// to US English still sits in Asia/Kolkata).

const ZONE_COUNTRY: Record<string, string> = {
  "Asia/Kolkata": "IN",
  "Asia/Calcutta": "IN",
  "Asia/Dubai": "AE",
  "Asia/Singapore": "SG",
  "Europe/London": "GB",
  "Asia/Karachi": "US",
};


export function countryFromZone(zone: string | null | undefined) {
  if (!zone) {
    return null;
  }

  if (ZONE_COUNTRY[zone]) {
    return ZONE_COUNTRY[zone];
  }

  if (zone.startsWith("Australia/")) {
    return "AU";
  }

  return null;
}


// Kept so a stored/guessed value can be trusted.
export function asCurrency(value: string | null | undefined): Currency | null {
  return value && isCurrency(value) ? value : null;
}


export const DAILY_MESSAGES: Record<Plan, number> = {
  free: 20,
  team: 100,
};

// Which built-in models sit above basic. A local
// model not named here is basic. A hosted model
// not named here is not offered built-in at all -
// Opus, for one, is too expensive to hand out and
// stays available on your own key.
//
// The hosted ones only exist when the server has
// its own Anthropic or OpenAI key, which Teamski
// does not. So the plan page promises the local
// models alone; these lines stay so adding a key
// later needs no code change - only the page.

const STANDARD = new Set([
  "qwen3:4b",
  "anthropic/claude-haiku-4-5",
  "openai/gpt-4.1-mini",
]);

const BEST = new Set([
  "anthropic/claude-sonnet-5",
  "openai/gpt-4.1",
  "openai/gpt-4o",
]);

// Hosted models the platform hands out on the
// Free plan, off a shared key it pays nothing for
// (Groq's free tier). These are "basic" like the
// machine's own models, so every plan includes
// them; the daily message allowance rations them.

const FREE_HOSTED = new Set([
  "groq/openai/gpt-oss-120b",
  "groq/openai/gpt-oss-20b",
  "groq/qwen/qwen3.8-27b",
  "cerebras/gpt-oss-120b",
  "cerebras/qwen-3.8-27b",
]);


export function tierOf(modelId: string): Tier | null {
  if (BEST.has(modelId)) {
    return "best";
  }

  if (STANDARD.has(modelId)) {
    return "standard";
  }

  if (FREE_HOSTED.has(modelId)) {
    return "basic";
  }

  // No slash is the machine's own model.

  return modelId.includes("/") ? null : "basic";
}


export function builtinAllowed(
  plan: Plan,
  modelId: string
) {
  const tier = tierOf(modelId);

  return (
    tier !== null &&
    TIER_RANK[tier] <= TIER_RANK[PLAN_TIER[plan]]
  );
}


// The cheapest plan whose built-in models include
// this one, for "available on Team".

export function planForModel(
  modelId: string
): Plan | null {
  const tier = tierOf(modelId);

  if (tier === null) {
    return null;
  }

  return (
    (Object.keys(PLAN_TIER) as Plan[]).find(
      (plan) =>
        TIER_RANK[PLAN_TIER[plan]] >= TIER_RANK[tier]
    ) ?? null
  );
}


// ------------------------------------------
// THE PLAN PAGE
// ------------------------------------------

export type Offer = {
  plan: Plan;
  blurb: string;
  features: string[];
};

export const OFFERS: Offer[] = [
  {
    plan: "free",
    blurb: "Start a project and bring your whole team.",
    features: [
      "Create projects and invite as many people as you like",
      "Built-in AI: GPT-OSS 120B, served fast by Groq",
      `${DAILY_MESSAGES.free} built-in AI messages a day per person`,
      "Bring a free Google Gemini key for faster answers",
      "Agents, files and connections",
    ],
  },
  {
    plan: "team",
    blurb: "Everything unlocked, for a team that works with AI every day.",
    features: [
      "Everything in Free, for the whole project",
      `${Math.round(DAILY_MESSAGES.team / DAILY_MESSAGES.free)}× the built-in AI messages — ${DAILY_MESSAGES.team} a day per person`,
      "Use your own Claude, ChatGPT, Gemini, Grok and other API keys",
      "Share one API key with the project, with a monthly cap and a spend report",
      "Connect apps: Notion, Linear, Jira, Asana, Sentry — or any MCP server by its address",
      `${SCHEDULES_PER_PROJECT.team} scheduled agents per project`,
    ],
  },
];


// ------------------------------------------
// CHECKS
// ------------------------------------------

export function isUpgrade(from: Plan, to: Plan) {
  return RANK[to] > RANK[from];
}


export function allows(plan: Plan, feature: Feature) {
  return INCLUDED[feature].includes(plan);
}


// ------------------------------------------
// KEYS THAT ARE FREE TO GET
// ------------------------------------------
//
// Google hands out Gemini API keys for nothing
// (aistudio.google.com), rate limited. A key like
// that costs Teamski nothing either, and it makes
// the Free plan fast and genuinely useful, where
// the small built-in model on a CPU server is
// neither. So on every plan, somebody may bring a
// key for these services; everything else, and
// sharing a key with a project, stays on Team.

export const FREE_KEY_SERVICES = [
  "google",
  "groq",
  "cerebras",
];

export function ownKeyAllowed(plan: Plan, service: string) {
  return (
    allows(plan, "own_keys") ||
    FREE_KEY_SERVICES.includes(service)
  );
}


// The cheapest plan that includes a feature, for
// "available on Team" rather than a vague lock.

export function planFor(feature: Feature): Plan {
  return INCLUDED[feature][0];
}


export async function planOf(
  db: SupabaseClient | null,
  userId: string | null
): Promise<Plan> {
  if (!db || !userId) {
    return "free";
  }

  const { data, error } = await db
    .from("subscriptions")
    .select("plan, current_period_end")
    .eq("user_id", userId)
    .maybeSingle();

  // No row, or no table yet, is Free. Failing
  // closed matters here: a missing migration
  // should not quietly hand out paid features.

  if (error || !data) {
    return "free";
  }

  // A subscription that has run out is Free
  // again, without waiting for anything to
  // notice and rewrite the row.

  if (
    data.current_period_end &&
    new Date(data.current_period_end) < new Date()
  ) {
    return "free";
  }

  return data.plan === "team" ? "team" : "free";
}


export type ProjectPlanInfo = {
  plan: Plan;

  // Who pays for this project, when it is on a paid
  // plan. Null on Free or before the per-project
  // table exists.
  ownerId: string | null;

  currentPeriodEnd: string | null;

  // How the plan was paid for. "promo" is the free
  // launch trial - Team, but never charged - so the UI
  // can say "free trial" rather than "renews".
  provider: string | null;
};


// A project's plan, and who pays for it, from its
// own subscription row. Needs the service role so a
// member can be told their project's plan without
// reading the billing row directly. No row, or a
// lapsed one, is Free.

export async function projectPlan(
  admin: SupabaseClient | null,
  projectId: string | null
): Promise<ProjectPlanInfo> {
  const free: ProjectPlanInfo = {
    plan: "free",
    ownerId: null,
    currentPeriodEnd: null,
    provider: null,
  };

  if (!admin || !projectId) {
    return free;
  }

  const { data, error } = await admin
    .from("project_subscriptions")
    .select(
      "plan, owner_id, current_period_end, provider"
    )
    .eq("project_id", projectId)
    .maybeSingle();

  // Only a genuinely missing table (before 0029 is
  // run) falls back to the old way - the owner's
  // personal plan. Any other error fails closed to
  // Free, so a transient glitch never hands a project
  // a paid plan it did not buy.

  if (error) {
    const code = (error as { code?: string }).code;

    const tableMissing =
      code === "42P01" || code === "PGRST205";

    return {
      plan: tableMissing
        ? await legacyOwnerPlan(admin, projectId)
        : "free",
      ownerId: null,
      currentPeriodEnd: null,
      provider: null,
    };
  }

  if (!data) {
    return free;
  }

  const ownerId =
    (data.owner_id as string | null) ?? null;

  const periodEnd =
    (data.current_period_end as string | null) ??
    null;

  if (
    periodEnd &&
    new Date(periodEnd) < new Date()
  ) {
    return {
      plan: "free",
      ownerId,
      currentPeriodEnd: periodEnd,
      provider: null,
    };
  }

  return {
    plan: data.plan === "team" ? "team" : "free",
    ownerId,
    currentPeriodEnd: periodEnd,
    provider:
      (data.provider as string | null) ?? null,
  };
}


// The project's plan alone, for the many callers
// that only need that.

export async function projectOwnerPlan(
  admin: SupabaseClient | null,
  projectId: string | null
): Promise<Plan> {
  return (await projectPlan(admin, projectId)).plan;
}


// The plan a project's owner is on personally - the
// pre-per-project way of deciding a project's plan.
// Kept only as a fallback for the moment before the
// project_subscriptions table exists.

async function legacyOwnerPlan(
  admin: SupabaseClient | null,
  projectId: string | null
): Promise<Plan> {
  if (!admin || !projectId) {
    return "free";
  }

  const { data: owner } = await admin
    .from("project_members")
    .select("user_id")
    .eq("project_id", projectId)
    .eq("role", "owner")
    .limit(1)
    .maybeSingle();

  return planOf(admin, owner?.user_id ?? null);
}


// ==========================================
// PROJECT ROLES
// ==========================================
//
// Who may do what inside a project. The owner pays
// and can do everything, billing and deleting
// included. An admin runs the project day to day -
// members, settings, connections, schedules - but
// not its money or its existence. A member uses it.
//

export type ProjectRole =
  | "owner"
  | "admin"
  | "member";

export type ProjectAction =
  | "use"
  | "manage_members"
  | "manage_settings"
  | "manage_connections"
  | "manage_schedules"
  | "manage_billing"
  | "delete_project"
  | "transfer_ownership";

const ROLE_ACTIONS: Record<
  ProjectRole,
  ProjectAction[]
> = {
  owner: [
    "use",
    "manage_members",
    "manage_settings",
    "manage_connections",
    "manage_schedules",
    "manage_billing",
    "delete_project",
    "transfer_ownership",
  ],

  admin: [
    "use",
    "manage_members",
    "manage_settings",
    "manage_connections",
    "manage_schedules",
  ],

  member: ["use"],
};

export const ROLE_LABELS: Record<
  ProjectRole,
  string
> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};


// May this role do this, in a project? A missing
// role (not a member) may do nothing.

export function can(
  role: ProjectRole | null | undefined,
  action: ProjectAction
): boolean {
  return role
    ? ROLE_ACTIONS[role].includes(action)
    : false;
}


// Someone's role in a project, or null when they
// are not in it. The membership read is the caller's
// own, so RLS keeps it to projects they belong to.

export async function roleInProject(
  db: SupabaseClient | null,
  projectId: string | null,
  userId: string | null
): Promise<ProjectRole | null> {
  if (!db || !projectId || !userId) {
    return null;
  }

  const { data } = await db
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  const role = data?.role as
    | ProjectRole
    | undefined;

  return role &&
    (role === "owner" ||
      role === "admin" ||
      role === "member")
    ? role
    : null;
}


// The plan where somebody is standing, for a
// request that names a project. Only a project
// they are actually in counts - otherwise anybody
// could borrow a paid project's plan by naming
// its id.

export async function planForMember(options: {
  db: SupabaseClient;
  admin: SupabaseClient | null;
  userId: string | null;
  projectId: string | null;
}): Promise<Plan> {
  if (!options.userId) {
    return "free";
  }

  if (options.projectId) {
    const { data: membership } = await options.db
      .from("project_members")
      .select("role")
      .eq("project_id", options.projectId)
      .eq("user_id", options.userId)
      .maybeSingle();

    if (membership) {
      return projectOwnerPlan(
        options.admin ?? options.db,
        options.projectId
      );
    }
  }

  return planOf(options.db, options.userId);
}


// Which plan applies to something happening
// here: the project's, inside a project, and the
// person's own otherwise.

export async function planHere(options: {
  db: SupabaseClient | null;
  admin: SupabaseClient | null;
  userId: string | null;
  projectId: string | null;
}): Promise<Plan> {
  return options.projectId
    ? projectOwnerPlan(
        options.admin,
        options.projectId
      )
    : planOf(options.db, options.userId);
}


// ------------------------------------------
// TODAY'S ALLOWANCE
// ------------------------------------------

export function startOfDay() {
  const now = new Date();

  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    )
  ).toISOString();
}


export async function builtinUsedToday(
  db: SupabaseClient | null,
  userId: string | null
) {
  if (!db || !userId) {
    return 0;
  }

  const { count } = await db
    .from("usage_events")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("paid_by", ["local", "server"])
    .gte("created_at", startOfDay());

  return count ?? 0;
}


export class DailyLimitError extends Error {
  constructor(plan: Plan) {
    const next = (Object.keys(RANK) as Plan[]).find(
      (candidate) => RANK[candidate] > RANK[plan]
    );

    super(
      [
        `You have used today's ${DAILY_MESSAGES[plan]} built-in AI messages on ${PLAN_LABELS[plan]}.`,
        next
          ? `The project owner can move to ${PLAN_LABELS[next]} for ${DAILY_MESSAGES[next]} a day.`
          : "The allowance resets tomorrow.",
        next && allows(next, "own_keys") && !allows(plan, "own_keys")
          ? "On a paid plan an API key also works, and does not count toward this."
          : "",
      ]
        .filter(Boolean)
        .join(" ")
    );

    this.name = "DailyLimitError";
  }
}
