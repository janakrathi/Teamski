import { openSecret, sealSecret } from "../crypto/secrets.ts";

import type { SupabaseClient } from "@supabase/supabase-js";


// ==========================================
// CONNECTING A GOOGLE ACCOUNT
// ==========================================
//
// Separate from signing in with Google, which is
// a different job. Signing in asks "who are
// you", once. This asks "may I read your
// spreadsheet later, while you are not here",
// which needs offline access and a refresh
// token - neither of which the sign-in flow
// requests or keeps.
//
// The same OAuth client can serve both. It just
// needs this route's address added to its
// authorised redirect URIs.
//

export const GOOGLE_AUTH =
  "https://accounts.google.com/o/oauth2/v2/auth";

export const GOOGLE_TOKEN =
  "https://oauth2.googleapis.com/token";


// What the agent is allowed to do. One scope,
// and the narrowest one that still allows both
// reading and appending.
//
// Google sorts scopes into ordinary, "sensitive"
// and "restricted". Restricted means a CASA
// security assessment - a penetration test,
// thousands a year, renewed annually - before
// the app may pass a hundred users. Gmail is
// restricted. So is every Drive scope that can
// see files the app did not create, which is why
// there is no Drive scope here either.
//
// Sheets and Calendar are only sensitive: a free
// brand review before going public, and nothing
// after.

export const GOOGLE_SCOPES = [
  "openid",
  "email",

  // Read a spreadsheet, and append to one. The
  // full sheets scope covers both; there is no
  // append-only variant.
  //
  // This is a "sensitive" scope: a free brand
  // review before going public, and nothing more.
  "https://www.googleapis.com/auth/spreadsheets",
];

// Nothing from Drive, deliberately.
//
// Searching Drive by name needs
// drive.metadata.readonly, and every Drive scope
// that can see other people's files - including
// that one - is "restricted", which means the
// same CASA assessment as Gmail: a penetration
// test, thousands a year, renewed annually.
//
// One search tool is not worth that bill, and
// the Sheets API opens a spreadsheet by id
// without Drive's help. So the id comes from the
// person, pasted from the address bar, and this
// app never sees a list of your files.


export type Connection = {
  id: string;
  provider: string;
  account_email: string | null;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  scopes: string[];
};


export function googleCredentials() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;

  if (!id || !secret) {
    return null;
  }

  return { id, secret };
}


// ------------------------------------------
// KEEPING THE TOKEN ALIVE
// ------------------------------------------
//
// An access token lasts about an hour. A
// background agent that runs overnight will
// always find an expired one, so every read goes
// through here rather than trusting what is in
// the row.
//
// A minute of slack, so a token does not expire
// between the check and the call that uses it.
//

const EXPIRY_SLACK_MS = 60_000;

export async function freshAccessToken(
  db: SupabaseClient,
  connection: Connection
): Promise<
  | { ok: true; token: string }
  | { ok: false; error: string }
> {
  const expires = connection.expires_at
    ? new Date(connection.expires_at).getTime()
    : 0;

  if (
    expires >
    Date.now() + EXPIRY_SLACK_MS
  ) {
    return {
      ok: true,
      token: connection.access_token,
    };
  }

  if (!connection.refresh_token) {
    return {
      ok: false,

      error:
        "That Google connection has expired and cannot renew itself. Connect the account again in Settings.",
    };
  }

  const credentials = googleCredentials();

  if (!credentials) {
    return {
      ok: false,
      error:
        "Google is not configured on this server.",
    };
  }

  let response: Response;

  try {
    response = await fetch(GOOGLE_TOKEN, {
      method: "POST",

      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",
      },

      body: new URLSearchParams({
        client_id: credentials.id,
        client_secret: credentials.secret,
        refresh_token: connection.refresh_token,
        grant_type: "refresh_token",
      }),
    });
  } catch {
    return {
      ok: false,
      error: "Could not reach Google.",
    };
  }

  if (!response.ok) {
    // A revoked or expired refresh token is
    // permanent: the person took the permission
    // away, and only they can give it back.

    return {
      ok: false,

      error:
        "Google refused to renew that connection. Connect the account again in Settings.",
    };
  }

  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!payload.access_token) {
    return {
      ok: false,
      error: "Google sent back no token.",
    };
  }

  const expiresAt = new Date(
    Date.now() +
      (payload.expires_in ?? 3600) * 1000
  ).toISOString();

  // Refreshing does not return a new refresh
  // token, so that column is left alone.

  await db
    .from("connections")
    .update({
      access_token: sealSecret(payload.access_token),
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id);

  return {
    ok: true,
    token: payload.access_token,
  };
}


// ------------------------------------------
// THE CONNECTION FOR ONE PERSON
// ------------------------------------------

export async function getConnection(
  db: SupabaseClient,
  userId: string,
  provider = "google"
): Promise<Connection | null> {
  const { data } = await db
    .from("connections")
    .select(
      "id, provider, account_email, access_token, refresh_token, expires_at, scopes"
    )
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();

  if (!data) {
    return null;
  }

  // Opened here, once, so nothing downstream ever
  // handles the sealed form.

  const row = data as Connection;

  return {
    ...row,
    access_token: openSecret(row.access_token) ?? "",
    refresh_token: openSecret(row.refresh_token),
  };
}


// A token ready to use, or a sentence explaining
// why there is not one. Tools show that sentence
// to the model, which passes it on.

export async function googleToken(
  db: SupabaseClient,
  userId: string
): Promise<
  | { ok: true; token: string }
  | { ok: false; error: string }
> {
  const connection = await getConnection(
    db,
    userId
  );

  if (!connection) {
    return {
      ok: false,

      error:
        "No Google account is connected. The person can connect one in Settings, under Connections.",
    };
  }

  return freshAccessToken(db, connection);
}
