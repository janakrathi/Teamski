import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

import {
  finishSignIn,
  type McpServerRow,
} from "@/lib/mcp/client";

export const dynamic = "force-dynamic";


// ==========================================
// BACK FROM SIGNING IN TO AN APP
// ==========================================
//
// The state in the URL has to match a sign-in
// this person started, on a row they own. A code
// arriving with anyone else's state - or none -
// is somebody trying to attach their account to
// yours, and goes nowhere.
//

function back(request: NextRequest, reason?: string, name?: string) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;

  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host");

  const proto =
    request.headers.get("x-forwarded-proto") ??
    request.nextUrl.protocol.replace(":", "");

  let origin = host
    ? `${proto}://${host}`
    : request.nextUrl.origin;

  if (configured) {
    try {
      origin = new URL(configured).origin;
    } catch {
      // Keep the header-derived origin.
    }
  }

  const url = new URL("/", origin);

  url.searchParams.set(
    "connected",
    reason ? "error" : "mcp"
  );

  if (reason) {
    url.searchParams.set("reason", reason);
  }

  if (name) {
    url.searchParams.set("app", name);
  }

  return NextResponse.redirect(url);
}


export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const state = params.get("state");
  const code = params.get("code");

  const db = await createClient();

  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    return NextResponse.redirect(
      new URL("/login", request.nextUrl.origin)
    );
  }

  if (!state) {
    return back(request, "That sign-in did not start here.");
  }

  const { data } = await db
    .from("mcp_servers")
    .select("*")
    .eq("oauth_state", state)
    .eq("user_id", user.id)
    .maybeSingle();

  const row = data as McpServerRow | null;

  if (!row) {
    return back(request, "That sign-in did not start here, or has expired.");
  }

  // Refused at the app, or something went wrong
  // there. Say so and leave the row to retry.

  if (params.get("error") || !code) {
    await db
      .from("mcp_servers")
      .update({
        status: "error",
        error:
          params.get("error_description") ??
          "Sign-in was cancelled.",
        oauth_state: null,
        code_verifier: null,
      })
      .eq("id", row.id);

    return back(
      request,
      `${row.name}: sign-in was cancelled.`,
      row.name
    );
  }

  try {
    await finishSignIn(db, row, code);

    return back(request, undefined, row.name);
  } catch (cause) {
    const message =
      cause instanceof Error
        ? cause.message
        : "Sign-in failed.";

    await db
      .from("mcp_servers")
      .update({
        status: "error",
        error: message,
        oauth_state: null,
        code_verifier: null,
      })
      .eq("id", row.id);

    return back(request, `${row.name}: ${message}`, row.name);
  }
}
