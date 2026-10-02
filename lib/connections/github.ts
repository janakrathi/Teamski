import type { SupabaseClient } from "@supabase/supabase-js";

import { getConnection } from "./google.ts";


// ==========================================
// CONNECTING A GITHUB ACCOUNT
// ==========================================
//
// Simpler than Google in one important way:
// GitHub's OAuth App tokens do not expire, so
// there is no refresh dance and no clock to
// watch. They can still be revoked, which shows
// up as a 401 and means the same thing - connect
// again.
//

export const GITHUB_AUTH =
  "https://github.com/login/oauth/authorize";

export const GITHUB_TOKEN =
  "https://github.com/login/oauth/access_token";

export const GITHUB_API = "https://api.github.com";


// Public repositories only, by default.
//
// GitHub's repo scope is all or nothing: it
// grants read *and write* on every private
// repository the person can reach, including
// their employer's. That is a lot to hand over
// for "read me that file", so it is asked for
// only when somebody deliberately chooses it.

export const GITHUB_PUBLIC_SCOPES = [
  "read:user",
  "public_repo",
];

export const GITHUB_PRIVATE_SCOPES = [
  "read:user",
  "repo",
];


export function githubCredentials() {
  const id = process.env.GITHUB_CLIENT_ID;
  const secret = process.env.GITHUB_CLIENT_SECRET;

  if (!id || !secret) {
    return null;
  }

  return { id, secret };
}


// A token, or a sentence saying why there is
// not one. Tools hand that sentence to the
// model, which passes it on to a person who can
// act on it.

export async function githubToken(
  db: SupabaseClient,
  userId: string
): Promise<
  | { ok: true; token: string }
  | { ok: false; error: string }
> {
  const connection = await getConnection(
    db,
    userId,
    "github"
  );

  if (!connection) {
    return {
      ok: false,

      error:
        "No GitHub account is connected. The person can connect one in Settings, under Connections.",
    };
  }

  return {
    ok: true,
    token: connection.access_token,
  };
}


// "owner/name", however it was written. People
// paste whole URLs.

export function repoPath(value: string) {
  const raw = (value ?? "").trim();

  const fromUrl = raw.match(
    /github\.com\/([^/\s]+\/[^/\s#?]+)/
  );

  const path = fromUrl ? fromUrl[1] : raw;

  return path.replace(/\.git$/, "");
}


export async function githubFetch(
  token: string,
  path: string
) {
  return fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
}


// What went wrong, in words worth repeating to
// somebody who can fix it.

export function githubError(status: number) {
  if (status === 401) {
    return "GitHub rejected the token. The connection may have been revoked - connect the account again in Settings.";
  }

  if (status === 403) {
    return "GitHub refused that. Either it is rate limited, or the connected account only granted access to public repositories.";
  }

  if (status === 404) {
    return "GitHub could not find that. Check the owner/name, and note that private repositories need the wider grant when connecting.";
  }

  return `GitHub returned an error (${status}).`;
}
