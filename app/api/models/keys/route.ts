import { sealSecret } from "@/lib/crypto/secrets";

import { createClient } from "@/lib/supabase/server";

import {
  MODEL_PREFIX,
  PRESETS,
  isNative,
  presetById,
} from "@/lib/ai/providers";

import { ANTHROPIC_MODELS } from "@/lib/ai/providers/anthropic";

import { OPENAI_MODELS } from "@/lib/ai/providers/openai";

import { credentialsFor, usageToday } from "@/lib/ai/providers/keys";

import { adminClient } from "@/lib/supabase/admin";

import {
  FREE_KEY_SERVICES,
  PLAN_LABELS,
  allows,
  ownKeyAllowed,
  planFor,
  planOf,
  projectOwnerPlan,
  type Plan,
} from "@/lib/plans";

import type { SupabaseClient } from "@supabase/supabase-js";


// A key is kept against the person, but whether
// it works is the project's plan. So the question
// "may I add one" is asked about the project you
// are in - and only one you are actually a member
// of, or anybody could borrow a paid project's
// plan by naming it.

async function planWhere(
  db: SupabaseClient,
  userId: string | null,
  projectId: string | null
): Promise<Plan> {
  if (!userId) {
    return "free";
  }

  if (projectId) {
    const { data: membership } = await db
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .maybeSingle();

    if (membership) {
      return projectOwnerPlan(
        adminClient() ?? db,
        projectId
      );
    }
  }

  return planOf(db, userId);
}

export const dynamic = "force-dynamic";


// ==========================================
// ADDING YOUR OWN MODEL KEY
// ==========================================
//
// A key is checked before it is kept. Storing an
// unverified one only moves the failure to the
// middle of somebody's first message, where it
// is harder to connect to what they just typed.
//
// It is never read back out. This route writes
// it; the chat route uses it server side; no
// response contains it.
//


// A cheap authenticated call that proves the key
// works, on each service's own terms.

async function verify(
  service: string,
  key: string,
  baseUrl?: string
): Promise<string | null> {
  try {
    if (service === "anthropic") {
      const response = await fetch(
        "https://api.anthropic.com/v1/models?limit=1",
        {
          headers: {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
          },
        }
      );

      if (response.status === 401) {
        return "Anthropic rejected that key.";
      }

      return response.ok
        ? null
        : `Anthropic returned ${response.status}.`;
    }

    // NVIDIA lists its models to anybody, key or
    // no key, so the list proves nothing. One
    // token from a model does: a wrong key gets a
    // 403 there.

    if (service === "nvidia" && baseUrl) {
      const response = await fetch(
        `${baseUrl.replace(/\/$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "nvidia/nemotron-3.5-lightning-30b-a3b",
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 1,
          }),
          signal: AbortSignal.timeout(20_000),
        }
      );

      if (response.status === 401 || response.status === 403) {
        return "NVIDIA rejected that key.";
      }

      // Busy (429) still means the key is real.
      return response.ok || response.status === 429
        ? null
        : `NVIDIA returned ${response.status}.`;
    }

    // Everything else speaks OpenAI, including
    // whatever somebody runs themselves.

    const root =
      baseUrl ?? "https://api.openai.com/v1";

    const response = await fetch(
      `${root.replace(/\/$/, "")}/models`,
      {
        headers: key
          ? { Authorization: `Bearer ${key}` }
          : {},
      }
    );

    if (response.status === 401) {
      return "That key was rejected.";
    }

    // Google answers a bad key with a 400.
    if (
      service === "google" &&
      (response.status === 400 || response.status === 403)
    ) {
      return "Google rejected that key. Copy it again from Google AI Studio - it starts with AIza.";
    }

    if (response.status === 404) {
      return "That address answered, but not with a model list. Check the base URL - it usually ends in /v1.";
    }

    return response.ok
      ? null
      : `That service returned ${response.status}.`;
  } catch {
    return "Could not reach that service. Check the address, and that it is running.";
  }
}


// What each service is called wherever it is
// shown - the settings list, and the group
// heading in the model picker. The two native
// ones have no preset to carry a label, so they
// are named here.

const LABELS: Record<string, string> = {
  anthropic: "Anthropic Claude",
  openai: "OpenAI ChatGPT",
};


function labelFor(service: string) {
  return (
    LABELS[service] ??
    presetById(service)?.label ??
    service
  );
}


export async function GET(request: Request) {
  // What could be added, so the settings panel
  // does not carry its own copy of the list.

  // The four almost everybody is looking for
  // come first and are named the way people know
  // them, rather than by the company alone. The
  // rest are real options, not lesser ones - they
  // are just not what somebody opening this panel
  // for the first time is here for.

  const FIRST = [
    "anthropic",
    "openai",
    "google",
    "xai",
  ];

  const services = [
    {
      id: "anthropic",
      label: labelFor("anthropic"),
      keysUrl:
        "https://console.anthropic.com/settings/keys",
      native: true,
    },
    {
      id: "openai",
      label: labelFor("openai"),
      keysUrl:
        "https://platform.openai.com/api-keys",
      native: true,
    },

    ...PRESETS.map((preset) => ({
      id: preset.id,
      label: preset.label,
      keysUrl: preset.keysUrl,
      baseUrl: preset.baseUrl,
      selfHosted: preset.selfHosted ?? false,
      note: preset.note,
      native: false,
    })),
  ].map((service) => ({
    ...service,
    primary: FIRST.includes(service.id),
  }));

  // Who is asking decides what they may do with
  // the list, and which keys they already have.
  // Connected keys are listed from the raw rows,
  // not from what the plan allows, so a key saved
  // before a plan lapsed can still be seen and
  // removed.

  const db = await createClient();

  const {
    data: { user },
  } = await db.auth.getUser();

  const plan = await planWhere(
    db,
    user?.id ?? null,
    new URL(request.url).searchParams.get(
      "projectId"
    )
  );

  const connected = user
    ? (await credentialsFor(db, user.id)).map(
        (entry) => ({
          service: entry.service,
          label: entry.label,
          models: entry.models.length,
        })
      )
    : [];

  // How much of a free key's day is gone, per
  // model - Google counts each model's limit
  // separately. Google does not tell an app what
  // is left, so this is Teamski's own count since
  // Google's day began, measured against the limit
  // the person copied from AI Studio for each
  // model. Use of the same key elsewhere is not
  // seen - it is a guide, and says so.

  const usage: Record<
    string,
    {
      since: string;
      resetsAt: string;
      models: {
        id: string;
        label: string;
        requests: number;
        dailyLimit: number | null;
      }[];
    }
  > = {};

  if (user) {
    const mine = await credentialsFor(db, user.id);

    for (const service of FREE_KEY_SERVICES) {
      const credential = mine.find((entry) => entry.service === service);

      if (!credential) {
        continue;
      }

      const today = await usageToday(db, user.id, service);

      usage[service] = {
        since: today.since.toISOString(),

        // A day later is near enough: a daylight
        // saving change moves it by an hour twice a
        // year.
        resetsAt: new Date(today.since.getTime() + 86_400_000).toISOString(),

        models: credential.models.map((model) => ({
          id: model.id,
          label: model.label,
          requests: today.byModel[model.id] ?? 0,
          dailyLimit: credential.dailyLimits?.[model.id] ?? null,
        })),
      };
    }
  }

  return Response.json({
    plan,
    planLabel: PLAN_LABELS[plan],
    allowed: allows(plan, "own_keys"),
    requiredPlan: PLAN_LABELS[planFor("own_keys")],

    // Keys any plan may add - Gemini's are free
    // to get.
    freeServices: FREE_KEY_SERVICES,

    connected,
    usage,

    services: [
      // Keep FIRST in the order it is written,
      // then everything else as the presets have
      // it - which puts "your own server" last,
      // where it belongs.
      ...FIRST.map((id) =>
        services.find(
          (service) => service.id === id
        )
      ).filter(Boolean),

      ...services.filter(
        (service) => !service.primary
      ),
    ],
  });
}


export async function POST(request: Request) {
  const db = await createClient();

  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    return Response.json(
      { error: "You must be logged in." },
      { status: 401 }
    );
  }

  // Checked before the key is even looked at, so
  // a Free account never has one verified or
  // stored.

  const peek = (await request
    .clone()
    .json()
    .catch(() => ({}))) as {
    projectId?: string;
    service?: string;
  };

  if (
    !ownKeyAllowed(
      await planWhere(
        db,
        user.id,
        peek.projectId ?? null
      ),
      (peek.service ?? "").trim()
    )
  ) {
    return Response.json(
      {
        error: `Using your own ${
          labelFor((peek.service ?? "").trim())
        } key is part of ${
          PLAN_LABELS[planFor("own_keys")]
        }. Google Gemini keys are free to get and work on every plan.`,
        upgrade: planFor("own_keys"),
      },
      { status: 403 }
    );
  }

  const body = (await request
    .json()
    .catch(() => ({}))) as {
    service?: string;
    key?: string;
    baseUrl?: string;
    models?: string;
  };

  const service = (body.service ?? "").trim();

  const key = (body.key ?? "").trim();

  if (!service) {
    return Response.json(
      { error: "Say which service." },
      { status: 400 }
    );
  }

  const preset = presetById(service);

  const selfHosted = preset?.selfHosted ?? false;

  const baseUrl =
    (body.baseUrl ?? "").trim() ||
    preset?.baseUrl ||
    undefined;

  if (!key && !selfHosted) {
    return Response.json(
      { error: "A key is required." },
      { status: 400 }
    );
  }

  if (selfHosted && !baseUrl) {
    return Response.json(
      {
        error:
          "Your own server needs an address, such as http://localhost:8000/v1.",
      },
      { status: 400 }
    );
  }

  const wrong = await verify(
    service,
    key,
    isNative(service) ? undefined : baseUrl
  );

  if (wrong) {
    return Response.json(
      { error: wrong },
      { status: 400 }
    );
  }

  // Which models to offer. A typed list wins,
  // then the service's own suggestions.

  const typed = (body.models ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((id) => ({ id, label: id }));

  const models =
    typed.length > 0
      ? typed
      : service === "anthropic"
        ? ANTHROPIC_MODELS
        : service === "openai"
          ? OPENAI_MODELS
          : (preset?.suggested ?? []);

  if (models.length === 0) {
    return Response.json(
      {
        error:
          "Name at least one model, separated by commas.",
      },
      { status: 400 }
    );
  }

  const { error } = await db
    .from("connections")
    .upsert(
      {
        user_id: user.id,
        provider: `${MODEL_PREFIX}${service}`,

        // The name of the service, for the
        // settings list. Never the key.
        account_email: labelFor(service),

        access_token: sealSecret(key || "none"),
        refresh_token: null,
        expires_at: null,
        scopes: [],

        config: {
          base_url: isNative(service)
            ? null
            : baseUrl,
          label: labelFor(service),
          models,
        },

        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" }
    );

  if (error) {
    if (
      error.code === "42703" ||
      error.code === "PGRST204"
    ) {
      return Response.json(
        {
          error:
            "Run supabase/migrations/0015_provider_keys.sql first.",
          needsMigration: true,
        },
        { status: 400 }
      );
    }

    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }

  // Somebody who just connected a free Gemini key
  // wants the fast answers now, not after finding
  // the model picker. So if they were still on the
  // built-in model, Gemini becomes their default.
  // A model they chose themselves is left alone.

  let defaultModel: string | null = null;

  if (FREE_KEY_SERVICES.includes(service)) {
    const { data: profile } = await db
      .from("profiles")
      .select("default_model")
      .eq("id", user.id)
      .maybeSingle();

    const current = (profile?.default_model as string | null) ?? "";

    if (!current || !current.includes("/")) {
      const chosen = `${service}/${models[0].id}`;

      const { error: chooseError } = await db
        .from("profiles")
        .update({ default_model: chosen })
        .eq("id", user.id);

      if (!chooseError) {
        defaultModel = chosen;
      }
    }
  }

  return Response.json({
    ok: true,
    models: models.length,
    defaultModel,
  });
}


export async function DELETE(request: Request) {
  const db = await createClient();

  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    return Response.json(
      { error: "You must be logged in." },
      { status: 401 }
    );
  }

  const service =
    new URL(request.url).searchParams.get(
      "service"
    ) ?? "";

  const { error } = await db
    .from("connections")
    .delete()
    .eq("user_id", user.id)
    .eq("provider", `${MODEL_PREFIX}${service}`);

  if (error) {
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return Response.json({ ok: true });
}


// ------------------------------------------
// A KEY'S DAILY LIMIT
// ------------------------------------------
//
// Typed in by the person from AI Studio, one per
// model, so the settings can show how much of each
// is used and the chat knows which models are
// already out. Kept in the connection's config
// next to its models; the key is not touched.

export async function PATCH(request: Request) {
  const db = await createClient();

  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    return Response.json(
      { error: "You must be logged in." },
      { status: 401 }
    );
  }

  const body = (await request
    .json()
    .catch(() => ({}))) as {
    service?: string;
    model?: string;
    dailyLimit?: number | string | null;
  };

  const service = (body.service ?? "").trim();

  const modelId = (body.model ?? "").trim();

  if (!modelId) {
    return Response.json(
      { error: "Say which model the limit is for." },
      { status: 400 }
    );
  }

  const raw = body.dailyLimit;

  const dailyLimit =
    raw === null || raw === ""
      ? null
      : Math.floor(Number(raw));

  if (
    dailyLimit !== null &&
    (!Number.isFinite(dailyLimit) || dailyLimit < 1 || dailyLimit > 1_000_000)
  ) {
    return Response.json(
      { error: "Enter the daily limit as a whole number, like 1000." },
      { status: 400 }
    );
  }

  const { data: row } = await db
    .from("connections")
    .select("config")
    .eq("user_id", user.id)
    .eq("provider", `${MODEL_PREFIX}${service}`)
    .maybeSingle();

  if (!row) {
    return Response.json(
      { error: "Connect that service first." },
      { status: 404 }
    );
  }

  const config = (row.config as Record<string, unknown> | null) ?? {};

  const limits = {
    ...((config.daily_limits as Record<string, number> | undefined) ?? {}),
  };

  if (dailyLimit === null) {
    delete limits[modelId];
  } else {
    limits[modelId] = dailyLimit;
  }

  const { error } = await db
    .from("connections")
    .update({
      config: { ...config, daily_limits: limits },
    })
    .eq("user_id", user.id)
    .eq("provider", `${MODEL_PREFIX}${service}`);

  if (error) {
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return Response.json({ ok: true, dailyLimit });
}
