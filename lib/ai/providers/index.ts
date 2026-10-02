import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_MODEL,
  NUM_CTX,
  streamChat as ollamaStream,
  type ChatChunk,
} from "../ollama.ts";

import {
  ANTHROPIC_MODELS,
  anthropicKey,
  anthropicProvider,
} from "./anthropic.ts";

import {
  OPENAI_MODELS,
  openaiKey,
  openaiProvider,
} from "./openai.ts";

import {
  GROQ_BASE_URL,
  GROQ_MODELS,
  groqKey,
} from "./groq.ts";

import {
  // Cerebras is out of the shared chain and the
  // picker for now - the account returns 402 on
  // every request. Only the key check is kept, so a
  // stale Cerebras default still recovers to Groq.
  cerebrasKey,
} from "./cerebras.ts";

import { PRESETS, presetById } from "./compatible.ts";

import { projectOverspent } from "../spend.ts";

import { fallbackOrder, unlessLimited } from "./limits.ts";

import {
  DAILY_MESSAGES,
  DailyLimitError,
  allows,
  builtinAllowed,
  ownKeyAllowed,
  builtinUsedToday,
  planHere,
  type Plan,
} from "../../plans.ts";

import {
  credentialsFor,
  projectCredential,
  qualify,
  usageToday,
  unqualify,
  type ModelCredential,
} from "./keys.ts";

import type {
  Credential,
  ModelInfo,
  StreamOptions,
} from "./types.ts";

export type { Credential, ModelInfo, StreamOptions };

export { PRESETS, presetById };

export {
  credentialsFor,
  isNative,
  qualify,
  unqualify,
  MODEL_PREFIX,
} from "./keys.ts";


// ==========================================
// WHICH MODEL, WHOSE KEY
// ==========================================
//
// A model id says which service it belongs to:
// "anthropic/claude-opus-5", "groq/llama-3.3".
// Anything without a slash is local - Ollama's
// own names use a colon, so "qwen3:1.7b" falls
// through to the machine, which is the right
// default and the one everybody had before there
// was a choice.
//


// The order the shared free models are tried, best
// first. Each has its own daily bucket, so a spike
// that drains one keeps landing on a strong model
// before the local machine: Groq's 120B, then its
// 20B, then its 27B.
//
// Cerebras used to sit in here for its far larger
// daily limits, but the account is returning 402 on
// every request, so it is pulled out until that is
// sorted - add the two entries back once it answers.
const SHARED_CHAIN: {
  service: string;
  id: string;
  keyFn: () => string | null;
  baseUrl: string;
}[] = [
  {
    service: "groq",
    id: "openai/gpt-oss-120b",
    keyFn: groqKey,
    baseUrl: GROQ_BASE_URL,
  },
  {
    service: "groq",
    id: "openai/gpt-oss-20b",
    keyFn: groqKey,
    baseUrl: GROQ_BASE_URL,
  },
  {
    service: "groq",
    id: "qwen/qwen3.8-27b",
    keyFn: groqKey,
    baseUrl: GROQ_BASE_URL,
  },
];


export const LOCAL_MODELS: ModelInfo[] = [
  {
    id: DEFAULT_MODEL,
    label: `${DEFAULT_MODEL} (local)`,

    // What Ollama was actually started with,
    // which on a small card is the real limit
    // rather than what the model could hold.
    contextWindow: NUM_CTX,
  },
  {
    id: "qwen3:4b",
    label: "qwen3:4b (local)",
    contextWindow: NUM_CTX,
  },
];


export type ModelGroup = {
  service: string;
  label: string;
  local: boolean;
  models: ModelInfo[];
};


// ------------------------------------------
// WHAT THIS PERSON CAN ACTUALLY USE
// ------------------------------------------
//
// Their own keys, plus whatever the server has
// in its environment as a fallback. A model
// nobody can reach is not offered - offering it
// and failing on click is the pattern the login
// page already taught us not to repeat.
//

export async function modelsFor(
  db: SupabaseClient,
  userId: string,

  // A member with no key of their own can still
  // use whatever the project pays for, so those
  // models belong in the list.
  projectId?: string | null,
  admin?: SupabaseClient | null
): Promise<ModelGroup[]> {
  // Inside a project, the project's plan decides;
  // outside one, your own.

  const plan = await planHere({
    db,
    admin: admin ?? db,
    userId,
    projectId: projectId ?? null,
  });

  // Built-in models the plan includes. A model
  // above the plan is left out rather than
  // offered and refused on click.

  const groups: ModelGroup[] = [
    {
      service: "ollama",
      label: "On this machine",
      local: true,

      models: LOCAL_MODELS.filter((model) =>
        builtinAllowed(plan, model.id)
      ),
    },
  ];

  // Keys are a paid feature, apart from the ones
  // that are free to get (Gemini). A key saved on
  // a plan that has since lapsed stays saved, it
  // just is not offered.

  const mine = (await credentialsFor(db, userId)).filter(
    (entry) => ownKeyAllowed(plan, entry.service)
  );

  const has = (service: string) =>
    mine.some(
      (entry) => entry.service === service
    );

  for (const credential of mine) {
    groups.push({
      service: credential.service,
      label: credential.label,
      local: false,

      models: (credential.models.length > 0
        ? credential.models
        : defaultModelsFor(credential.service)
      ).map((model) => ({
        ...model,
        id: qualify(credential.service, model.id),
      })),
    });
  }

  // What the project pays for. Skipped where the
  // person already has their own key for that
  // service, since theirs is what would be spent.

  if (
    projectId &&
    admin &&
    allows(plan, "shared_keys")
  ) {
    const { data: shared } = await admin
      .from("project_model_keys")
      .select("service, label, models")
      .eq("project_id", projectId);

    for (const row of (shared ?? []) as {
      service: string;
      label: string | null;
      models: ModelInfo[] | null;
    }[]) {
      if (has(row.service)) {
        continue;
      }

      const models =
        row.models && row.models.length > 0
          ? row.models
          : defaultModelsFor(row.service);

      groups.push({
        service: row.service,

        label: `${
          row.label ?? row.service
        } (shared)`,

        local: false,

        models: models.map((model) => ({
          ...model,
          id: qualify(row.service, model.id),
        })),
      });
    }
  }

  // The environment variables stay meaningful for
  // a workspace one person runs alone, but only
  // when they have not added a key of their own.

  // The server's own keys are the built-in
  // hosted models, rationed by plan like the
  // machine's.

  const builtin = (
    service: string,
    list: ModelInfo[]
  ) =>
    list
      .map((model) => ({
        ...model,
        id: qualify(service, model.id),
      }))
      .filter((model) =>
        builtinAllowed(plan, model.id)
      );

  // Groq's shared key is the Free plan's fast,
  // capable model - offered to everyone the moment
  // the server has a key, no setup, unless the
  // person brought their own Groq key.

  const groqBuiltin = builtin("groq", GROQ_MODELS);

  if (
    !has("groq") &&
    groqKey() &&
    groqBuiltin.length > 0
  ) {
    groups.push({
      service: "groq",
      label: "Groq (built-in · fast, free)",
      local: false,
      models: groqBuiltin,
    });
  }

  // Cerebras's built-in group is withheld while the
  // account 402s - offering a model that fails on
  // click is the pattern the login page taught us not
  // to repeat. Restore this block (and the two
  // SHARED_CHAIN entries) once the account answers.

  const anthropicBuiltin = builtin(
    "anthropic",
    ANTHROPIC_MODELS
  );

  if (
    !has("anthropic") &&
    anthropicKey() &&
    anthropicBuiltin.length > 0
  ) {
    groups.push({
      service: "anthropic",
      label: "Anthropic (built-in)",
      local: false,
      models: anthropicBuiltin,
    });
  }

  const openaiBuiltin = builtin(
    "openai",
    OPENAI_MODELS
  );

  if (
    !has("openai") &&
    openaiKey() &&
    openaiBuiltin.length > 0
  ) {
    groups.push({
      service: "openai",
      label: "OpenAI (built-in)",
      local: false,
      models: openaiBuiltin,
    });
  }

  return groups;
}


function defaultModelsFor(
  service: string
): ModelInfo[] {
  if (service === "anthropic") {
    return ANTHROPIC_MODELS;
  }

  if (service === "openai") {
    return OPENAI_MODELS;
  }

  return presetById(service)?.suggested ?? [];
}


// ------------------------------------------
// THE ONE CALL
// ------------------------------------------
//
// Everything that talks to a model goes through
// here, and the chunks are Ollama-shaped whoever
// produced them.
//

export type Answered = {
  stream: AsyncGenerator<ChatChunk>;

  // What actually answered, which is not always
  // what was asked for. A hosted model with no
  // key behind it falls back to the machine, and
  // the reply says so rather than quietly being
  // worse.
  model: string;

  fellBack: boolean;

  // Why, when it did. "no-key" means nothing
  // could pay; "budget" means the project's
  // shared key has spent its month; "plan" that
  // a key exists but the plan paying for this
  // does not include it.
  // "limit" that the key is over its limit on
  // every model it has; "limit-model" that the
  // chosen model was, and another model on the
  // same key answered.
  reason?: "no-key" | "budget" | "plan" | "limit" | "limit-model";

  // The model that was asked for, when another
  // one answered.
  from?: string;

  // Whose key paid: "you", "project", or null
  // when nothing was spent.
  paidBy: "you" | "project" | "server" | null;
};


// ------------------------------------------
// WHEN A KEY HITS ITS LIMIT
// ------------------------------------------
//
// A free Gemini key runs out - per minute, and per
// day. The provider refuses the very first
// request with a 429, before a word is written,
// so the first chunk is read here: if it is that
// refusal, the turn is answered on the built-in
// model instead and says why, rather than showing
// the person an error from Google.
//
// Anything after the first chunk is a real reply
// already on screen and is left alone.

export async function streamFor(
  db: SupabaseClient | null,
  userId: string | null,
  options: Omit<StreamOptions, "credential"> & {
    // Whose shared key to fall back to.
    projectId?: string | null;

    // Reading a key the caller may spend but not
    // see needs the service role.
    admin?: SupabaseClient | null;
  }
): Promise<Answered> {
  const { service, model } = unqualify(
    options.model
  );

  const admin = options.admin ?? db;

  const plan = await planHere({
    db,
    admin,
    userId,
    projectId: options.projectId ?? null,
  });

  // Built-in answers come out of today's
  // allowance. Checked against turns already
  // recorded, so every step of one turn sees the
  // same count and a turn is never cut off
  // halfway.

  const spendAllowance = async (on: Plan) => {
    if (
      (await builtinUsedToday(admin, userId)) >=
      DAILY_MESSAGES[on]
    ) {
      throw new DailyLimitError(on);
    }
  };

  // No service means the local machine.

  if (!service) {
    const wanted = model || DEFAULT_MODEL;

    // A bigger local model is a paid tier too.

    const included = builtinAllowed(plan, wanted);

    await spendAllowance(plan);

    return {
      stream: ollamaStream({
        model: included ? wanted : DEFAULT_MODEL,
        messages: options.messages,
        tools: options.tools,
        think: options.think,

        options: {
          num_ctx: NUM_CTX,
          ...options.options,
        },

        signal: options.signal,
      }),

      model: included ? wanted : DEFAULT_MODEL,
      fellBack: !included,
      reason: included ? undefined : "plan",
      paidBy: null,
    };
  }

  // Yours first, then the project's. Your own key
  // winning matters: somebody who has paid for
  // their own account should spend that rather
  // than quietly drawing on the company's.

  const saved: ModelCredential | null =
    db && userId
      ? (await credentialsFor(db, userId)).find(
          (entry) => entry.service === service
        ) ?? null
      : null;

  const ownAllowed = saved
    ? ownKeyAllowed(plan, service)
    : false;

  const mine = ownAllowed ? saved : null;

  // The project's key, unless the project has
  // already spent its month. Checked before the
  // turn rather than after: a limit that reports
  // the overspend is an invoice with extra steps.

  const offered = mine
    ? null
    : await projectCredential(
        options.admin ?? null,
        options.projectId ?? null,
        service
      );

  // The shared key is the owner's bill, so the
  // owner's plan decides.

  const sharedAllowed = offered
    ? allows(plan, "shared_keys")
    : false;

  const candidate = sharedAllowed ? offered : null;

  const locked =
    (saved !== null && !ownAllowed) ||
    (offered !== null && !sharedAllowed);

  const budget = candidate
    ? await projectOverspent(
        options.admin ?? null,
        options.projectId ?? null,
        service
      )
    : { over: false, limit: null, spent: 0 };

  const shared = budget.over ? null : candidate;

  const stored = mine ?? shared;

  // A key from the environment is the last resort
  // and belongs to whoever runs the server. The
  // providers read it themselves; here it only
  // decides whether falling back is necessary.

  const envKey =
    service === "anthropic"
      ? anthropicKey()
      : service === "openai"
        ? openaiKey()
        : service === "groq"
          ? groqKey()
          : service === "cerebras"
            ? cerebrasKey()
            : null;

  const preset = presetById(service);

  // A server somebody runs themselves needs an
  // address and often no key, so an address is
  // enough to count as reachable.

  // The server's key is the built-in hosted
  // model, and only for models the plan includes.

  const serverAllowed =
    envKey !== null &&
    builtinAllowed(plan, options.model);

  const reachable =
    stored !== null ||
    serverAllowed ||
    Boolean(preset?.baseUrl && preset.selfHosted);

  if (!reachable) {
    // Falling back is a built-in answer too.
    await spendAllowance(plan);
  }

  if (!reachable) {
    // Nothing to pay with. Answer on the machine
    // rather than failing, and say so - a reply
    // that is quietly worse is the bad outcome
    // here, not a reply that explains itself.

    return {
      stream: ollamaStream({
        model: DEFAULT_MODEL,
        messages: options.messages,
        tools: options.tools,
        think: options.think,

        options: {
          num_ctx: NUM_CTX,
          ...options.options,
        },

        signal: options.signal,
      }),

      model: DEFAULT_MODEL,
      fellBack: true,

      // Which of the two reasons, since they need
      // different sentences: nothing to pay with,
      // or a shared budget already spent.
      reason: budget.over
        ? ("budget" as const)
        : locked ||
            (envKey !== null && !serverAllowed)
          ? ("plan" as const)
          : ("no-key" as const),

      paidBy: null,
    };
  }

  // A stored key wins; otherwise a preset served
  // off the server's own key (Groq's shared key)
  // carries that key and the preset's address, so
  // the OpenAI client points at the right host
  // with a real key rather than an empty one.

  const credential: Credential | undefined = stored
    ? { key: stored.key, baseUrl: stored.baseUrl }
    : envKey && preset?.baseUrl
      ? { key: envKey, baseUrl: preset.baseUrl }
      : undefined;

  const call = { ...options, model, credential };

  const paidBy = mine
    ? ("you" as const)
    : shared
      ? ("project" as const)
      : ("server" as const);

  if (paidBy === "server") {
    await spendAllowance(plan);
  }

  // The key was refused for being over its limit:
  // the built-in model answers, out of the plan's
  // allowance like any other built-in answer.

  const limited = async (): Promise<Answered> => {
    if (paidBy !== "server") {
      await spendAllowance(plan);
    }

    return {
      stream: ollamaStream({
        model: DEFAULT_MODEL,
        messages: options.messages,
        tools: options.tools,
        think: options.think,

        options: {
          num_ctx: NUM_CTX,
          ...options.options,
        },

        signal: options.signal,
      }),

      model: DEFAULT_MODEL,
      fellBack: true,
      reason: "limit",
      paidBy: null,
    };
  };

  // Over its limit on the chosen model, the same
  // key usually still has others: Google counts a
  // free key's limit per model. So those are tried
  // first - most room left first, skipping any
  // Teamski has already seen used up today - and
  // only then the built-in model.

  const onAnotherModel = async (
    run: (model: string) => AsyncGenerator<ChatChunk>
  ): Promise<Answered | null> => {
    const models = stored?.models.map((entry) => entry.id) ?? [];

    if (models.length < 2) {
      return null;
    }

    const used =
      mine && db && userId
        ? (await usageToday(db, userId, service)).byModel
        : {};

    const order = fallbackOrder({
      chosen: model,
      models,
      used,
      limits: mine ? (stored?.dailyLimits ?? {}) : {},
    }).slice(0, 3);

    for (const next of order) {
      const checked = await unlessLimited(run(next));

      if (checked) {
        return {
          stream: checked,
          model: qualify(service, next),
          fellBack: true,
          reason: "limit-model",
          from: options.model,
          paidBy,
        };
      }
    }

    return null;
  };

  if (service === "anthropic") {
    const checked = await unlessLimited(anthropicProvider.stream(call));

    if (!checked) {
      return (
        (await onAnotherModel((next) =>
          anthropicProvider.stream({ ...call, model: next })
        )) ?? limited()
      );
    }

    return {
      stream: checked,
      model: options.model,
      fellBack: false,
      paidBy,
    };
  }

  // Everything else is OpenAI's API. For a preset
  // the address comes from the table when the
  // stored row did not carry one.

  if (
    !credential?.baseUrl &&
    service !== "openai" &&
    preset?.baseUrl
  ) {
    call.credential = {
      key: credential?.key ?? "",
      baseUrl: preset.baseUrl,
    };
  }

  const viaSharedChain =
    paidBy === "server" &&
    (service === "groq" || service === "cerebras");

  // A shared provider that fails - rate limited, an
  // account that needs billing (402), or briefly down
  // - should not sink the turn; it falls to the next
  // in the chain. So for the shared chain any error is
  // a miss, not a throw. A person's own key still
  // throws, so a bad key is reported to them.
  const attempt = async (
    gen: AsyncGenerator<ChatChunk>
  ): Promise<AsyncGenerator<ChatChunk> | null> => {
    if (!viaSharedChain) {
      return unlessLimited(gen);
    }

    try {
      return await unlessLimited(gen);
    } catch {
      return null;
    }
  };

  const checked = await attempt(
    openaiProvider.stream(call)
  );

  if (!checked) {
    // The shared free chain, in priority order: each
    // model has its own daily bucket, so a spike (or a
    // provider that needs billing) keeps landing on a
    // strong model before the local machine.
    if (viaSharedChain) {
      for (const step of SHARED_CHAIN) {
        // Skip the model that just failed.
        if (
          step.service === service &&
          step.id === model
        ) {
          continue;
        }

        const keyValue = step.keyFn();

        if (!keyValue) {
          continue;
        }

        const stream = await attempt(
          openaiProvider.stream({
            ...call,
            model: step.id,
            credential: {
              key: keyValue,
              baseUrl: step.baseUrl,
            },
          })
        );

        if (stream) {
          return {
            stream,
            model: qualify(step.service, step.id),
            fellBack: true,
            reason: "limit-model",
            from: options.model,
            paidBy,
          };
        }
      }
    }

    return (
      (await onAnotherModel((next) =>
        openaiProvider.stream({ ...call, model: next })
      )) ?? limited()
    );
  }

  return {
    stream: checked,
    model: options.model,
    fellBack: false,
    paidBy,
  };
}


// Where the thinking happens - the one thing the
// sign-in page makes a promise about.

export function isLocal(model: string) {
  return unqualify(model).service === null;
}


export function serviceOf(model: string) {
  return unqualify(model).service ?? "ollama";
}
