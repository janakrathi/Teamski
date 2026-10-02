import { sealSecret } from "@/lib/crypto/secrets";

import { NextResponse } from "next/server";

import type { NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

import {
  GOOGLE_AUTH,
  GOOGLE_SCOPES,
  GOOGLE_TOKEN,
  googleCredentials,
} from "@/lib/connections/google";

import {
  consumeState,
  issueState,
} from "@/lib/connections/state";

export const dynamic = "force-dynamic";


// ==========================================
// CONNECTING, AND COMING BACK
// ==========================================
//
// One route, two halves. Without a code it sends
// you to Google; with one it finishes the job.
// They share the redirect URI that way, which
// means one address to register rather than two.
//


// The address Google must be told about, built
// from the host the browser actually used rather
// than the one the server is bound to. Behind a
// tunnel or a proxy those differ, and getting it
// wrong sends people to localhost.

function publicOrigin(request: NextRequest) {
  const configured =
    process.env.NEXT_PUBLIC_SITE_URL;

  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // A malformed setting should not take the
      // whole flow down.
    }
  }

  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host");

  if (!host) {
    return request.nextUrl.origin;
  }

  const proto =
    request.headers.get("x-forwarded-proto") ??
    request.nextUrl.protocol.replace(":", "");

  return `${proto}://${host}`;
}


function back(origin: string, message?: string) {
  const url = new URL("/", origin);

  // The settings panel reads these and opens
  // itself on the Connections tab.

  url.searchParams.set(
    "connected",
    message ? "error" : "google"
  );

  if (message) {
    url.searchParams.set("reason", message);
  }

  return NextResponse.redirect(url);
}


export async function GET(request: NextRequest) {
  const origin = publicOrigin(request);

  const db = await createClient();

  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    return NextResponse.redirect(
      new URL("/login", origin)
    );
  }

  const credentials = googleCredentials();

  if (!credentials) {
    return back(
      origin,
      "Google is not configured on this server. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local."
    );
  }

  const redirectUri = `${origin}/api/connections/google`;

  const code =
    request.nextUrl.searchParams.get("code");

  const denied =
    request.nextUrl.searchParams.get("error");


  // ----------------------------------------
  // ON THE WAY OUT
  // ----------------------------------------

  if (!code && !denied) {
    const authorize = new URL(GOOGLE_AUTH);

    authorize.searchParams.set(
      "client_id",
      credentials.id
    );

    authorize.searchParams.set(
      "redirect_uri",
      redirectUri
    );

    authorize.searchParams.set(
      "response_type",
      "code"
    );

    authorize.searchParams.set(
      "scope",
      GOOGLE_SCOPES.join(" ")
    );

    // offline is what earns a refresh token, and
    // consent is what makes Google hand one over
    // again on a second connect - without it a
    // reconnect returns none and the connection
    // dies quietly in an hour.

    authorize.searchParams.set(
      "access_type",
      "offline"
    );

    authorize.searchParams.set(
      "prompt",
      "consent"
    );

    // Lets people pick which of their accounts
    // to connect, rather than silently using
    // whichever they happen to be signed in as.

    authorize.searchParams.set(
      "include_granted_scopes",
      "true"
    );

    // Ties this return to this departure. Without
    // it, a link can land a signed-in person on
    // the callback carrying somebody else's code,
    // and they quietly connect a stranger's
    // account.

    authorize.searchParams.set(
      "state",
      await issueState("google")
    );

    return NextResponse.redirect(authorize);
  }


  // ----------------------------------------
  // ON THE WAY BACK
  // ----------------------------------------

  const stateOk = await consumeState(
    "google",
    request.nextUrl.searchParams.get("state")
  );

  if (!stateOk) {
    return back(
      origin,
      "That sign-in did not start here, so nothing was connected. Try again from Settings."
    );
  }

  if (denied) {
    return back(
      origin,
      denied === "access_denied"
        ? "You did not grant access, so nothing was connected."
        : denied
    );
  }

  let payload: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    id_token?: string;
  };

  try {
    const response = await fetch(GOOGLE_TOKEN, {
      method: "POST",

      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",
      },

      body: new URLSearchParams({
        code: code!,
        client_id: credentials.id,
        client_secret: credentials.secret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!response.ok) {
      const detail = await response
        .text()
        .catch(() => "");

      return back(
        origin,

        detail.includes("redirect_uri_mismatch")
          ? `Google does not recognise ${redirectUri}. Add it to the OAuth client's authorised redirect URIs.`
          : "Google refused to complete the connection."
      );
    }

    payload = await response.json();
  } catch {
    return back(origin, "Could not reach Google.");
  }

  if (!payload.access_token) {
    return back(
      origin,
      "Google sent back no token."
    );
  }

  // Which account was actually connected. The id
  // token carries it, and it is worth showing:
  // people have several Google accounts and
  // connecting the wrong one is easy to do and
  // hard to notice.

  let email: string | null = null;

  if (payload.id_token) {
    try {
      const [, body] =
        payload.id_token.split(".");

      email =
        JSON.parse(
          Buffer.from(body, "base64url").toString()
        ).email ?? null;
    } catch {
      // A name for the row is a nicety, not a
      // reason to fail the connection.
    }
  }

  const granted = (payload.scope ?? "")
    .split(" ")
    .filter(Boolean);

  const { error } = await db
    .from("connections")
    .upsert(
      {
        user_id: user.id,
        provider: "google",
        account_email: email,
        access_token: sealSecret(payload.access_token),
        refresh_token: sealSecret(
          payload.refresh_token ?? null
        ),

        expires_at: new Date(
          Date.now() +
            (payload.expires_in ?? 3600) * 1000
        ).toISOString(),

        scopes: granted,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" }
    );

  if (error) {
    return back(
      origin,

      error.code === "42P01" ||
        error.code === "PGRST205"
        ? "Run supabase/migrations/0012_connections.sql first."
        : error.message
    );
  }

  return back(origin);
}
