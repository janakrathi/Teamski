import type { SupabaseClient } from "@supabase/supabase-js";

import { openSecret, sealSecret } from "@/lib/crypto/secrets";

import {
  CHATGPT_LABEL,
  CHATGPT_SERVICE,
  ChatGPTPlanError,
  exchangeCode,
  grantsPlanUsage,
  listPlanModels,
  parseCallback,
  verifyIdToken,
  type PendingSignIn,
} from "@/lib/ai/providers/chatgpt";

import { MODEL_PREFIX } from "@/lib/ai/providers/keys";


// ==========================================
// FINISHING A CHATGPT SIGN-IN
// ==========================================
//
// The sign-in's secrets (PKCE verifier, nonce, state)
// wait in a short-lived, sealed, http-only cookie on
// Teamski's own address, so nothing about a half-done
// sign-in is stored in the database. Whether the
// callback arrives on its own or as a pasted address,
// it ends here.
//

export const PENDING_COOKIE = "teamski_chatgpt_signin";

const TEN_MINUTES = 10 * 60;

export function pendingCookie(pending: PendingSignIn, secure: boolean) {
  const value = encodeURIComponent(sealSecret(JSON.stringify(pending)) ?? "");

  return `${PENDING_COOKIE}=${value}; Path=/; Max-Age=${TEN_MINUTES}; HttpOnly; SameSite=Lax${
    secure ? "; Secure" : ""
  }`;
}

export function clearPendingCookie() {
  return `${PENDING_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

export function readPending(request: Request): PendingSignIn | null {
  const cookie = (request.headers.get("cookie") ?? "")
    .split(/;\s*/)
    .find((part) => part.startsWith(`${PENDING_COOKIE}=`));

  if (!cookie) {
    return null;
  }

  try {
    const plain = openSecret(decodeURIComponent(cookie.slice(PENDING_COOKIE.length + 1)));

    const pending = plain ? (JSON.parse(plain) as PendingSignIn) : null;

    return pending && Date.now() - pending.at < TEN_MINUTES * 1000 ? pending : null;
  } catch {
    return null;
  }
}


// The issued client id from a previous sign-in, so a
// reconnect reuses this installation's registration.
export async function savedClientId(db: SupabaseClient, userId: string) {
  const { data } = await db
    .from("connections")
    .select("config")
    .eq("user_id", userId)
    .eq("provider", `${MODEL_PREFIX}${CHATGPT_SERVICE}`)
    .maybeSingle();

  return (data?.config as { client_id?: string } | null)?.client_id ?? null;
}


export async function finishSignIn(options: {
  db: SupabaseClient;
  userId: string;
  pending: PendingSignIn | null;
  callbackUrl: string;
}): Promise<{ ok: true; email: string | null; models: number; defaultModel: string | null } | { ok: false; error: string }> {
  const { db, userId, pending } = options;

  if (!pending) {
    return { ok: false, error: "That sign-in has expired. Start again from Settings, under Models." };
  }

  const back = parseCallback(options.callbackUrl);

  if (!back) {
    return { ok: false, error: "That doesn't look like the address from the sign-in page." };
  }

  if (back.error) {
    return { ok: false, error: `ChatGPT sign-in was cancelled (${back.error}).` };
  }

  if (!back.code || back.state !== pending.state) {
    return { ok: false, error: "That address is from a different sign-in. Start again from Settings, under Models." };
  }

  const clientId = back.clientId ?? pending.clientId;

  if (!clientId) {
    return { ok: false, error: "ChatGPT didn't register Teamski. Start the sign-in again." };
  }

  try {
    const tokens = await exchangeCode({
      clientId,
      code: back.code,
      verifier: pending.verifier,
      redirectUri: pending.redirectUri,
    });

    const claims = tokens.id_token
      ? await verifyIdToken(tokens.id_token, { clientId, nonce: pending.nonce })
      : null;

    if (!claims) {
      return { ok: false, error: "ChatGPT sign-in could not be verified." };
    }

    if (!grantsPlanUsage(tokens.scope, back.scope)) {
      return {
        ok: false,
        error: "Signed in, but plan usage wasn't granted. It needs ChatGPT Plus or Pro, and allowing Teamski to use your plan.",
      };
    }

    const models = await listPlanModels(tokens.access_token);

    if (models.length === 0) {
      return { ok: false, error: "Your ChatGPT plan has no models available to Teamski yet." };
    }

    const { error } = await db.from("connections").upsert(
      {
        user_id: userId,
        provider: `${MODEL_PREFIX}${CHATGPT_SERVICE}`,
        account_email: claims.email ?? CHATGPT_LABEL,
        access_token: sealSecret(tokens.access_token),
        refresh_token: sealSecret(tokens.refresh_token ?? null),
        expires_at: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
        scopes: (tokens.scope ?? "").split(/\s+/).filter(Boolean),
        config: {
          label: CHATGPT_LABEL,
          client_id: clientId,
          models,
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" }
    );

    if (error) {
      return { ok: false, error: error.message };
    }

    // Like a new Gemini key: somebody still on the
    // built-in model wants their plan answering now.
    let defaultModel: string | null = null;

    const { data: profile } = await db
      .from("profiles")
      .select("default_model")
      .eq("id", userId)
      .maybeSingle();

    const current = (profile?.default_model as string | null) ?? "";

    if (!current || !current.includes("/")) {
      const chosen = `${CHATGPT_SERVICE}/${models[0].id}`;

      const { error: chooseError } = await db
        .from("profiles")
        .update({ default_model: chosen })
        .eq("id", userId);

      if (!chooseError) {
        defaultModel = chosen;
      }
    }

    return { ok: true, email: claims.email ?? null, models: models.length, defaultModel };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof ChatGPTPlanError
          ? error.message
          : "ChatGPT sign-in failed. Try again in a moment.",
    };
  }
}
