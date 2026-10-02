import { sealSecret } from "@/lib/crypto/secrets";

import { NextResponse } from "next/server";

import type { NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

import {
  GITHUB_AUTH,
  GITHUB_PRIVATE_SCOPES,
  GITHUB_PUBLIC_SCOPES,
  GITHUB_TOKEN,
  githubCredentials,
  githubFetch,
} from "@/lib/connections/github";

import {
  consumeState,
  issueState,
} from "@/lib/connections/state";

export const dynamic = "force-dynamic";


// ==========================================
// CONNECTING GITHUB, AND COMING BACK
// ==========================================
//
// One route, two halves, sharing a redirect URI
// so there is a single address to register.
//

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

  url.searchParams.set(
    "connected",
    message ? "error" : "github"
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

  const credentials = githubCredentials();

  if (!credentials) {
    return back(
      origin,
      "GitHub is not configured on this server. Add GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET to .env.local."
    );
  }

  const query = request.nextUrl.searchParams;

  const code = query.get("code");
  const denied = query.get("error");


  // ----------------------------------------
  // ON THE WAY OUT
  // ----------------------------------------

  if (!code && !denied) {
    const authorize = new URL(GITHUB_AUTH);

    authorize.searchParams.set(
      "client_id",
      credentials.id
    );

    authorize.searchParams.set(
      "redirect_uri",
      `${origin}/api/connections/github`
    );

    // Private access is deliberate, never the
    // default: GitHub's repo scope is read and
    // write on every private repository the
    // person can reach.

    authorize.searchParams.set(
      "scope",
      (query.get("private") === "1"
        ? GITHUB_PRIVATE_SCOPES
        : GITHUB_PUBLIC_SCOPES
      ).join(" ")
    );

    authorize.searchParams.set(
      "state",
      await issueState("github")
    );

    return NextResponse.redirect(authorize);
  }


  // ----------------------------------------
  // ON THE WAY BACK
  // ----------------------------------------

  const stateOk = await consumeState(
    "github",
    query.get("state")
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

  let token: string;
  let granted: string[];

  try {
    const response = await fetch(GITHUB_TOKEN, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },

      body: JSON.stringify({
        client_id: credentials.id,
        client_secret: credentials.secret,
        code,
        redirect_uri: `${origin}/api/connections/github`,
      }),
    });

    const payload = (await response.json()) as {
      access_token?: string;
      scope?: string;
      error_description?: string;
    };

    // GitHub answers 200 with an error in the
    // body rather than a failing status, so the
    // body is what has to be checked.

    if (!payload.access_token) {
      return back(
        origin,
        payload.error_description ??
          "GitHub refused to complete the connection."
      );
    }

    token = payload.access_token;

    granted = (payload.scope ?? "")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean);
  } catch {
    return back(origin, "Could not reach GitHub.");
  }

  // Which account was connected. Worth showing:
  // people have a work GitHub and a personal one
  // and connecting the wrong one is easy.

  let login: string | null = null;

  try {
    const who = await githubFetch(token, "/user");

    if (who.ok) {
      login = ((await who.json()) as {
        login?: string;
      }).login ?? null;
    }
  } catch {
    // A name for the row is a nicety, not a
    // reason to fail the connection.
  }

  const { error } = await db
    .from("connections")
    .upsert(
      {
        user_id: user.id,
        provider: "github",
        account_email: login,
        access_token: sealSecret(token),

        // OAuth App tokens do not expire, so
        // there is nothing to refresh and no
        // expiry to record.
        refresh_token: null,
        expires_at: null,

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
