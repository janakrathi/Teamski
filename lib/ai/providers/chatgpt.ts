import { createHash, createHmac, createPublicKey, randomBytes, verify as verifySignature } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { openSecret, sealSecret } from "../../crypto/secrets.ts";

import { SELF_HOSTED } from "../../plans.ts";

import type { ChatChunk, OllamaMessage, ToolCall, ToolSpec } from "../ollama.ts";

import { splitSystem, type StreamOptions } from "./types.ts";


// ==========================================
// A CHATGPT PLUS OR PRO PLAN, NO API KEY
// ==========================================
//
// OpenAI's "Sign in with ChatGPT" lets a Plus or Pro
// subscriber spend their plan's allowance in an app,
// instead of an API key: they sign in at OpenAI, pick
// how much of their week this app may use, and the app
// gets an OAuth token for the Responses API.
//
// OpenAI offers this to open-source apps people run
// themselves - which a self-hosted Teamski is. A paid,
// hosted service (teamski.in) has to be accepted by
// OpenAI first, so there it stays off until
// CHATGPT_PLAN=on is set after that approval.
//
// Docs: https://developers.openai.com/siwc/token-sharing-open-source
//

export const CHATGPT_SERVICE = "chatgpt";

export const CHATGPT_LABEL = "ChatGPT plan";

const ISSUER = "https://auth.openai.com";

const AUTHORIZE_URL = `${ISSUER}/api/accounts/authorize`;

const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;

const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;

const API = "https://api.openai.com/v1";

const SCOPE = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";

const PLAN_SCOPE = "chatgpt.tokens.use.direct";

// Where the browser lands when Teamski is not on this
// machine: a 127.0.0.1 address always means the
// computer running the browser, so that page won't
// load, and its address is pasted back into Teamski.
export const PASTE_REDIRECT = "http://127.0.0.1:1455/auth/callback";

const CALLBACK_PATH = "/api/models/chatgpt/callback";


export function chatgptPlanAvailable() {
  return SELF_HOSTED || /^(1|true|yes|on)$/i.test(process.env.CHATGPT_PLAN ?? "");
}


// A failure with a sentence written for the person,
// passed through as it is (lib/ai/errors.ts).
export class ChatGPTPlanError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ChatGPTPlanError";
    this.status = status;
  }
}


// ------------------------------------------
// THIS INSTALLATION
// ------------------------------------------
//
// OpenAI asks for a host id that stays the same for
// an installation and differs between them. Derived
// from the server's own secret, so it survives
// restarts and redeploys without being stored.

export function hostId() {
  const seed =
    process.env.CHATGPT_HOST_ID ||
    process.env.TEAMSKI_SECRET_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "teamski";

  if (/^(urn:|did:)/.test(seed)) {
    return seed;
  }

  const hex = createHmac("sha256", seed).update("chatgpt-host-id").digest("hex");

  // Shaped as a version 4 UUID.
  const uuid = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");

  return `urn:uuid:${uuid}`;
}


// ------------------------------------------
// STARTING A SIGN-IN
// ------------------------------------------

function base64url(bytes: Buffer) {
  return bytes.toString("base64url");
}

function isLoopback(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "");

  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".localhost")
  );
}

// Teamski on this machine can take the callback
// itself, at 127.0.0.1 on its own port. Anywhere else
// the address is pasted back.
export function redirectFor(appOrigin: string) {
  const url = new URL(appOrigin);

  if (isLoopback(url.hostname)) {
    const port = url.port || (url.protocol === "https:" ? "443" : "80");

    return { redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}`, paste: false };
  }

  return { redirectUri: PASTE_REDIRECT, paste: true };
}

// The state carries the app's own address, so a
// callback that lands on 127.0.0.1 can send the
// browser back to localhost, where the sign-in
// cookie is. Only loopback addresses are honoured -
// anything else would make this an open redirect.
export function stateFor(appOrigin: string) {
  return `${base64url(randomBytes(18))}.${base64url(Buffer.from(appOrigin))}`;
}

export function originInState(state: string) {
  const encoded = state.split(".")[1];

  if (!encoded) {
    return null;
  }

  try {
    const origin = new URL(Buffer.from(encoded, "base64url").toString("utf8"));

    if (!/^https?:$/.test(origin.protocol) || !isLoopback(origin.hostname)) {
      return null;
    }

    return origin.origin;
  } catch {
    return null;
  }
}

export type PendingSignIn = {
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
  clientId: string | null;
  at: number;
};

export function startSignIn(options: { appOrigin: string; clientId?: string | null }) {
  const { redirectUri, paste } = redirectFor(options.appOrigin);

  const verifier = base64url(randomBytes(32));

  const pending: PendingSignIn = {
    state: stateFor(options.appOrigin),
    nonce: base64url(randomBytes(18)),
    verifier,
    redirectUri,
    clientId: options.clientId ?? null,
    at: Date.now(),
  };

  const params = new URLSearchParams({
    // The first time, OpenAI registers this
    // installation and issues it a client id; after
    // that the issued one is used again.
    client_id: pending.clientId ?? "dynamic_agent_client",
    ext_agent_host_id: hostId(),
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPE,
    resource: API,
    state: pending.state,
    nonce: pending.nonce,
    code_challenge_method: "S256",
    code_challenge: base64url(createHash("sha256").update(verifier).digest()),
  });

  if (!pending.clientId) {
    params.set("agent_name_hint", "Teamski");
  }

  return { url: `${AUTHORIZE_URL}?${params}`, pending, paste };
}


// What came back on the callback, from a request or
// from the address somebody pasted.
export function parseCallback(address: string) {
  let url: URL;

  try {
    url = new URL(address.trim());
  } catch {
    return null;
  }

  const get = (name: string) => url.searchParams.get(name);

  return {
    code: get("code"),
    state: get("state"),
    clientId: get("client_id"),
    scope: get("scope"),
    error: get("error_description") || get("error"),
  };
}


// ------------------------------------------
// TOKENS
// ------------------------------------------

export type PlanTokens = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  scope?: string;
};

async function tokenRequest(body: Record<string, string>): Promise<PlanTokens> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });

  const data = (await response.json().catch(() => ({}))) as PlanTokens & {
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !data.access_token) {
    const reason = data.error ?? `status ${response.status}`;

    throw new ChatGPTPlanError(
      reason === "invalid_grant"
        ? "Your ChatGPT connection has ended. Connect it again in Settings, under Models."
        : `ChatGPT sign-in failed (${reason}).`,
      response.status
    );
  }

  return data;
}

export function exchangeCode(options: {
  clientId: string;
  code: string;
  verifier: string;
  redirectUri: string;
}) {
  return tokenRequest({
    grant_type: "authorization_code",
    client_id: options.clientId,
    code: options.code,
    code_verifier: options.verifier,
    redirect_uri: options.redirectUri,
    resource: API,
  });
}

export function refreshTokens(options: { clientId: string; refreshToken: string }) {
  return tokenRequest({
    grant_type: "refresh_token",
    client_id: options.clientId,
    refresh_token: options.refreshToken,
    resource: API,
  });
}


// The ID token proves who signed in, and that this
// answer belongs to this sign-in (the nonce). Checked
// against OpenAI's published keys before anything is
// stored.

type Jwk = { kid?: string; kty: string; alg?: string; [field: string]: unknown };

export async function verifyIdToken(
  idToken: string,
  expected: { clientId: string; nonce: string; now?: number; keys?: Jwk[] }
) {
  const [head, body, signature] = idToken.split(".");

  if (!head || !body || !signature) {
    throw new ChatGPTPlanError("ChatGPT sign-in returned an unreadable ID token.");
  }

  const header = JSON.parse(Buffer.from(head, "base64url").toString("utf8")) as {
    alg: string;
    kid?: string;
  };

  const keys =
    expected.keys ??
    ((await (await fetch(JWKS_URL)).json()) as { keys: Jwk[] }).keys;

  const jwk = keys.find((key) => !header.kid || key.kid === header.kid);

  if (!jwk) {
    throw new ChatGPTPlanError("ChatGPT sign-in was signed with an unknown key.");
  }

  const data = Buffer.from(`${head}.${body}`);

  const raw = Buffer.from(signature, "base64url");

  const publicKey = createPublicKey({ key: jwk as never, format: "jwk" });

  const valid =
    header.alg === "RS256"
      ? verifySignature("RSA-SHA256", data, publicKey, raw)
      : header.alg === "ES256"
        ? verifySignature("SHA256", data, { key: publicKey, dsaEncoding: "ieee-p1363" }, raw)
        : false;

  if (!valid) {
    throw new ChatGPTPlanError("ChatGPT sign-in could not be verified.");
  }

  const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
    iss?: string;
    aud?: string | string[];
    exp?: number;
    nonce?: string;
    email?: string;
    sub?: string;
  };

  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];

  const now = (expected.now ?? Date.now()) / 1000;

  if (
    claims.iss !== ISSUER ||
    !audience.includes(expected.clientId) ||
    !claims.exp ||
    claims.exp < now - 60 ||
    claims.nonce !== expected.nonce
  ) {
    throw new ChatGPTPlanError("ChatGPT sign-in could not be verified.");
  }

  return claims;
}

export function grantsPlanUsage(...scopes: (string | null | undefined)[]) {
  return scopes.some((scope) => (scope ?? "").split(/\s+/).includes(PLAN_SCOPE));
}


// The models this plan may use here, named the way
// ChatGPT names them.
export async function listPlanModels(accessToken: string) {
  const response = await fetch(`${API}/models`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new ChatGPTPlanError(`Could not list your ChatGPT plan's models (status ${response.status}).`);
  }

  const data = (await response.json()) as {
    models?: { slug: string; display_name?: string; visibility?: string }[];
    data?: { id: string }[];
  };

  if (data.models) {
    return data.models
      .filter((model) => !model.visibility || model.visibility === "list")
      .map((model) => ({ id: model.slug, label: model.display_name || model.slug }));
  }

  return (data.data ?? []).map((model) => ({ id: model.id, label: model.id }));
}


// ------------------------------------------
// KEEPING THE TOKEN FRESH
// ------------------------------------------
//
// An access token lasts an hour; the refresh token is
// replaced every time it is used. Two turns refreshing
// at once would spend the same refresh token twice and
// end the connection, so one refresh per person runs
// at a time.

const refreshing = new Map<string, Promise<string | null>>();

export async function freshPlanToken(db: SupabaseClient, userId: string) {
  const running = refreshing.get(userId);

  if (running) {
    return running;
  }

  const work = (async () => {
    const { data } = await db
      .from("connections")
      .select("access_token, refresh_token, expires_at, config")
      .eq("user_id", userId)
      .eq("provider", `model:${CHATGPT_SERVICE}`)
      .maybeSingle();

    if (!data) {
      return null;
    }

    const access = openSecret(data.access_token as string);

    const expires = data.expires_at ? Date.parse(data.expires_at as string) : 0;

    if (access && expires - Date.now() > 2 * 60_000) {
      return access;
    }

    const refresh = openSecret(data.refresh_token as string | null);

    const clientId = (data.config as { client_id?: string } | null)?.client_id;

    if (!refresh || !clientId) {
      return null;
    }

    const tokens = await refreshTokens({ clientId, refreshToken: refresh });

    await db
      .from("connections")
      .update({
        access_token: sealSecret(tokens.access_token),
        refresh_token: sealSecret(tokens.refresh_token ?? refresh),
        expires_at: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("provider", `model:${CHATGPT_SERVICE}`);

    return tokens.access_token;
  })();

  refreshing.set(userId, work);

  try {
    return await work;
  } finally {
    refreshing.delete(userId);
  }
}


// ------------------------------------------
// ASKING THE MODEL
// ------------------------------------------
//
// Plan usage only takes the Responses API, streamed
// and not stored, with no temperature or output cap,
// and no system items - the system prompt goes in as
// instructions.

type InputItem = Record<string, unknown>;

export function toResponsesInput(messages: OllamaMessage[]) {
  const { system, rest } = splitSystem(messages);

  const input: InputItem[] = [];

  // The app doesn't carry call ids, so they are made
  // up here and a tool result takes the oldest open id
  // for its tool's name.
  const open: { id: string; name: string }[] = [];

  let next = 0;

  for (const message of rest) {
    if (message.role === "assistant") {
      if (message.content) {
        input.push({ role: "assistant", content: message.content });
      }

      for (const call of message.tool_calls ?? []) {
        const id = `call_${next++}`;

        open.push({ id, name: call.function.name });

        input.push({
          type: "function_call",
          call_id: id,
          name: call.function.name,
          arguments: JSON.stringify(call.function.arguments ?? {}),
        });
      }

      continue;
    }

    if (message.role === "tool") {
      const at = open.findIndex((call) => call.name === (message.tool_name ?? call.name));

      if (at === -1) {
        // A result with no call to answer is refused by
        // the API, so it goes in as plain text instead.
        input.push({
          role: "user",
          content: `Result of ${message.tool_name ?? "a tool"}:\n${message.content}`,
        });

        continue;
      }

      const [call] = open.splice(at, 1);

      input.push({ type: "function_call_output", call_id: call.id, output: message.content });

      continue;
    }

    if (message.images && message.images.length > 0) {
      input.push({
        role: "user",
        content: [
          ...(message.content ? [{ type: "input_text", text: message.content }] : []),
          ...message.images.map((url) => ({ type: "input_image", image_url: url })),
        ],
      });

      continue;
    }

    input.push({ role: "user", content: message.content });
  }

  return { instructions: system, input };
}

export function toResponsesTools(tools: ToolSpec[] | undefined) {
  return (tools ?? [])
    .filter((spec) => Boolean(spec.function?.name))
    .map((spec) => ({
      type: "function",
      name: spec.function.name,
      description: spec.function.description,
      parameters: spec.function.parameters,
      // Strict schemas need every field required, which
      // most tools (and every MCP server) don't do.
      strict: false,
    }));
}


// Server-sent events, one JSON object per "data:".
export async function* readEvents(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();

  let buffer = "";

  for await (const piece of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(piece, { stream: true });

    let cut: number;

    while ((cut = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const block = buffer.slice(0, cut);

      buffer = buffer.slice(cut).replace(/^\r?\n\r?\n/, "");

      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");

      if (data && data !== "[DONE]") {
        try {
          yield JSON.parse(data) as Record<string, unknown>;
        } catch {
          // A line that isn't JSON is skipped.
        }
      }
    }
  }
}


// A refusal, as a sentence for the person. The weekly
// cap counts as a limit (status 429) so the turn falls
// to the next key or the built-in model.
export function planError(status: number, code: string | undefined, message?: string) {
  if (code === "subscription_sharing_usage_limit_exceeded" || status === 429) {
    return new ChatGPTPlanError(
      "Your ChatGPT plan has used the share of this week you gave Teamski. Raise it at chatgpt.com/settings/usage.",
      429
    );
  }

  if (code === "subscription_sharing_user_not_eligible") {
    return new ChatGPTPlanError(
      "Using a ChatGPT plan here needs ChatGPT Plus or Pro.",
      403
    );
  }

  if (code === "subscription_sharing_invalid_user" || code === "invalid_grant" || status === 401) {
    return new ChatGPTPlanError(
      "Your ChatGPT connection has ended. Connect it again in Settings, under Models.",
      401
    );
  }

  return new ChatGPTPlanError(
    `ChatGPT couldn't answer${message ? `: ${message}` : ""}.`,
    status
  );
}


export async function* stream(options: StreamOptions): AsyncGenerator<ChatChunk> {
  const token = options.credential?.key;

  if (!token) {
    throw planError(401, "invalid_grant");
  }

  const { instructions, input } = toResponsesInput(options.messages);

  const tools = toResponsesTools(options.tools);

  const response = await fetch(`${API}/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: options.model,
      instructions: instructions || undefined,
      input,
      tools: tools.length ? tools : undefined,
      store: false,
      stream: true,
    }),
    signal: options.signal,
  });

  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };

    throw planError(response.status, data.error?.code, data.error?.message);
  }

  const calls: ToolCall[] = [];

  let promptTokens = 0;
  let responseTokens = 0;

  for await (const event of readEvents(response.body)) {
    const type = event.type as string;

    if (type === "response.output_text.delta" && typeof event.delta === "string") {
      yield { message: { content: event.delta } };

      continue;
    }

    if (type === "response.output_item.done") {
      const item = event.item as { type?: string; name?: string; arguments?: string };

      if (item?.type === "function_call" && item.name) {
        let args: Record<string, string> = {};

        try {
          args = item.arguments ? JSON.parse(item.arguments) : {};
        } catch {
          // Reported empty rather than thrown, as for
          // the other providers.
        }

        calls.push({ function: { name: item.name, arguments: args } });
      }

      continue;
    }

    if (type === "response.completed") {
      const usage = (event.response as { usage?: Record<string, number> } | undefined)?.usage;

      promptTokens = usage?.input_tokens ?? 0;
      responseTokens = usage?.output_tokens ?? 0;

      continue;
    }

    if (type === "response.failed" || type === "error") {
      const error =
        (event.response as { error?: { code?: string; message?: string } } | undefined)?.error ??
        (event as { code?: string; message?: string });

      throw planError(0, error?.code, error?.message);
    }
  }

  if (calls.length > 0) {
    yield { message: { tool_calls: calls } };
  }

  yield {
    done: true,
    done_reason: calls.length > 0 ? "tool_calls" : "stop",
    prompt_eval_count: promptTokens,
    eval_count: responseTokens,
  };
}
