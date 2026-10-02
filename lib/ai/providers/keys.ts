import { openSecret } from "../../crypto/secrets.ts";

import type { SupabaseClient } from "@supabase/supabase-js";

import { presetById } from "./compatible.ts";

import type { ModelInfo } from "./types.ts";

import { pacificDayStart, requestsByModel } from "./limits.ts";


// ==========================================
// WHOSE KEY, AND FOR WHAT
// ==========================================
//
// Model keys are stored per person in the same
// table as the OAuth connections: one secret per
// person per provider, row level security
// keeping each to its owner, and an API that
// returns which services are connected but never
// the secret itself.
//
// The provider column is namespaced - "model:"
// - so a key for Groq cannot collide with the
// Google account somebody connected for Sheets.
//

export const MODEL_PREFIX = "model:";


// The two with their own SDK. Everything else
// speaks OpenAI's API at another address.

export const NATIVE = ["anthropic", "openai"];


export type ModelCredential = {
  // anthropic | openai | groq | deepseek | ...
  service: string;

  label: string;

  key: string;

  // Absent for the two native ones, which know
  // their own address.
  baseUrl?: string;

  models: ModelInfo[];

  // Requests a day per model, as the person typed
  // them from the provider's dashboard. Only ever
  // set on their own key.
  dailyLimits?: Record<string, number>;
};


export function isNative(service: string) {
  return NATIVE.includes(service);
}


// ------------------------------------------
// READING THEM BACK
// ------------------------------------------
//
// Called on every chat turn, so it asks for one
// row rather than all of them when it knows
// which service it needs.
//

export async function credentialsFor(
  db: SupabaseClient,
  userId: string
): Promise<ModelCredential[]> {
  const { data, error } = await db
    .from("connections")
    .select(
      "provider, access_token, account_email, config"
    )
    .eq("user_id", userId)
    .like("provider", `${MODEL_PREFIX}%`);

  if (error || !data) {
    // A database without migration 0015, or
    // without the table at all, simply has no
    // keys in it.

    return [];
  }

  return data.map((row) => {
    const service = String(row.provider).slice(
      MODEL_PREFIX.length
    );

    const config = (row.config ?? {}) as {
      base_url?: string;
      label?: string;
      models?: ModelInfo[];
      daily_limits?: Record<string, number>;
    };

    const preset = presetById(service);

    // What the preset knows about a model - its
    // context window, its usual free daily limit -
    // fills in whatever the saved row lacks, so a
    // key saved before those were known still gets
    // them.

    const known = new Map(
      (preset?.suggested ?? []).map((entry) => [entry.id, entry])
    );

    const defaults: Record<string, number> = {};

    for (const entry of preset?.suggested ?? []) {
      if (entry.dailyLimit) {
        defaults[entry.id] = entry.dailyLimit;
      }
    }

    return {
      service,

      label:
        config.label ||
        preset?.label ||
        service,

      key: openSecret(row.access_token as string) ?? "",

      baseUrl:
        config.base_url || preset?.baseUrl || undefined,

      models: (config.models ?? []).map((model) => ({
        ...model,
        contextWindow:
          model.contextWindow ?? known.get(model.id)?.contextWindow,
      })),

      // The person's own numbers win over the
      // usual ones.
      dailyLimits: { ...defaults, ...(config.daily_limits ?? {}) },
    };
  });
}


// ------------------------------------------
// TODAY'S USE OF ONE SERVICE, PER MODEL
// ------------------------------------------
//
// From Teamski's own record of turns on the
// person's own key since the provider's day began
// (midnight Pacific, Google's reset). Use of the
// same key outside Teamski is not in here.

export async function usageToday(
  db: SupabaseClient,
  userId: string,
  service: string
) {
  const since = pacificDayStart();

  const { data } = await db
    .from("usage_events")
    .select("model, tool_calls")
    .eq("user_id", userId)
    .eq("paid_by", "you")
    .like("model", `${service}/%`)
    .gte("created_at", since.toISOString())
    .limit(5000);

  return {
    since,
    byModel: requestsByModel(
      (data ?? []) as { model: string; tool_calls: number | null }[],
      service
    ),
  };
}


// ------------------------------------------
// THE KEY THE PROJECT SHARES
// ------------------------------------------
//
// Read with the service role, because the whole
// design is that members may spend this key
// without being able to read it. See
// lib/supabase/admin.ts for why.
//

export async function projectCredential(
  admin: SupabaseClient | null,
  projectId: string | null,
  service: string
): Promise<ModelCredential | null> {
  if (!admin || !projectId) {
    return null;
  }

  const { data } = await admin
    .from("project_model_keys")
    .select(
      "service, label, access_token, base_url, models"
    )
    .eq("project_id", projectId)
    .eq("service", service)
    .maybeSingle();

  if (!data) {
    return null;
  }

  const preset = presetById(service);

  return {
    service,

    label:
      (data.label as string | null) ||
      preset?.label ||
      service,

    key: openSecret(data.access_token as string) ?? "",

    baseUrl:
      (data.base_url as string | null) ||
      preset?.baseUrl ||
      undefined,

    models:
      (data.models as ModelInfo[] | null) ?? [],
  };
}


export async function credentialFor(
  db: SupabaseClient,
  userId: string,
  service: string
): Promise<ModelCredential | null> {
  const all = await credentialsFor(db, userId);

  return (
    all.find(
      (entry) => entry.service === service
    ) ?? null
  );
}


// ------------------------------------------
// WHICH SERVICE OWNS A MODEL
// ------------------------------------------
//
// Two people can have a model id that looks the
// same on different services, so the id carries
// its service: "groq/llama-3.3-70b". Ollama's
// own names contain a colon and no slash, which
// is what keeps "qwen3:1.7b" out of this.
//

export function qualify(
  service: string,
  modelId: string
) {
  return `${service}/${modelId}`;
}


export function unqualify(qualified: string): {
  service: string | null;
  model: string;
} {
  const cut = qualified.indexOf("/");

  if (cut === -1) {
    return { service: null, model: qualified };
  }

  return {
    service: qualified.slice(0, cut),
    model: qualified.slice(cut + 1),
  };
}
