import { createHash } from "node:crypto";

import { clientIp } from "../rate-limit.ts";

import { META_PIXEL_ID } from "./meta.ts";


// ==========================================
// META CONVERSIONS API
// ==========================================
//
// The server's half of Meta tracking. The pixel in the
// browser is blocked for a good share of visitors - ad
// blockers, antivirus, some networks - and those are
// exactly the signups ads never hear about. So the two
// conversions that matter, a signup and an enterprise
// enquiry, are also sent from here, server to Meta.
//
// Each carries the same event id as the pixel's copy, so
// when both arrive Meta keeps one.
//
// What is sent about the person: a SHA-256 hash of their
// email and account id (Meta matches hashes, never sees
// the address), their IP and browser, and Meta's own
// _fbp/_fbc cookies if the pixel set them. Never message
// content or anything from inside a workspace.
//
//   META_CAPI_TOKEN       Events Manager -> Settings ->
//                         Conversions API -> Generate
//                         access token. Unset: nothing
//                         is sent, nothing breaks.
//   META_TEST_EVENT_CODE  From the Test events tab. While
//                         set, every event lands there
//                         (and only there) - unset it
//                         once testing is done.
//   META_PIXEL_ID         Defaults to the pixel's ID.
//   META_GRAPH_VERSION    Defaults to v24.0.
//
// Relative imports only: scripts/meta-capi-test.mts
// loads this under plain node.
//

export type MetaUser = {
  email?: string | null;
  externalId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  fbp?: string | null;
  fbc?: string | null;
};

export type MetaEventInput = {
  name: string;

  // Shared with the pixel's copy of the same event, so
  // Meta can drop the duplicate.
  id: string;

  url?: string | null;

  // Seconds. Defaults to now.
  time?: number;

  user: MetaUser;

  custom?: Record<string, unknown>;
};


export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}


// Meta hashes what it holds the same way: trimmed and
// lower-cased first, or the hashes never match.
export function normaliseEmail(email: string) {
  return email.trim().toLowerCase();
}


export function buildMetaEvent(input: MetaEventInput) {
  const user: Record<string, unknown> = {};

  if (input.user.email?.trim()) {
    user.em = [sha256(normaliseEmail(input.user.email))];
  }

  if (input.user.externalId?.trim()) {
    user.external_id = [sha256(input.user.externalId.trim())];
  }

  if (input.user.ip && input.user.ip !== "unknown") {
    user.client_ip_address = input.user.ip;
  }

  if (input.user.userAgent) {
    user.client_user_agent = input.user.userAgent;
  }

  if (input.user.fbp) {
    user.fbp = input.user.fbp;
  }

  if (input.user.fbc) {
    user.fbc = input.user.fbc;
  }

  return {
    event_name: input.name,
    event_time: input.time ?? Math.floor(Date.now() / 1000),
    event_id: input.id,
    action_source: "website",
    ...(input.url ? { event_source_url: input.url } : {}),
    user_data: user,
    ...(input.custom ? { custom_data: input.custom } : {}),
  };
}


export function metaConfig() {
  const token = process.env.META_CAPI_TOKEN?.trim();

  const pixelId = (process.env.META_PIXEL_ID || META_PIXEL_ID).replace(
    /\D/g,
    ""
  );

  if (!token || !pixelId) {
    return null;
  }

  return {
    token,
    pixelId,
    testCode: process.env.META_TEST_EVENT_CODE?.trim() || null,
    version: process.env.META_GRAPH_VERSION?.trim() || "v24.0",
  };
}


// Who is asking, as far as Meta needs to know: address,
// browser, and Meta's own cookies if the pixel set them.

export function metaUserFromRequest(request: Request): MetaUser {
  const cookies = new Map(
    (request.headers.get("cookie") ?? "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter((pair) => pair.length >= 2)
      .map(([name, ...rest]) => [name, decodeURIComponent(rest.join("="))])
  );

  return {
    ip: clientIp(request.headers),
    userAgent: request.headers.get("user-agent"),
    fbp: cookies.get("_fbp") ?? null,
    fbc: cookies.get("_fbc") ?? null,
  };
}


// Never throws: tracking must not fail the thing being
// tracked. Says what happened, for logs and the test
// script.

export async function sendMetaEvents(
  events: MetaEventInput[],
  options: { testCode?: string | null } = {}
): Promise<
  | { sent: true; received: number }
  | { sent: false; reason: "not-configured" | "failed"; detail?: string }
> {
  const config = metaConfig();

  if (!config) {
    return { sent: false, reason: "not-configured" };
  }

  const testCode = options.testCode ?? config.testCode;

  try {
    const response = await fetch(
      `https://graph.facebook.com/${config.version}/${config.pixelId}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },

        // The token goes in the body, not the address,
        // so it never lands in a proxy or access log.
        body: JSON.stringify({
          data: events.map(buildMetaEvent),
          access_token: config.token,
          ...(testCode ? { test_event_code: testCode } : {}),
        }),

        signal: AbortSignal.timeout(8000),
      }
    );

    const body = (await response.json().catch(() => ({}))) as {
      events_received?: number;
      error?: { message?: string };
    };

    if (!response.ok) {
      const detail = body.error?.message ?? `HTTP ${response.status}`;

      console.error("Meta Conversions API refused an event:", detail);

      return { sent: false, reason: "failed", detail };
    }

    return { sent: true, received: body.events_received ?? events.length };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);

    console.error("Meta Conversions API unreachable:", detail);

    return { sent: false, reason: "failed", detail };
  }
}
