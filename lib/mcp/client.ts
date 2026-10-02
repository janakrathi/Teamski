import {
  openJson,
  openSecret,
  sealJson,
  sealSecret,
} from "../crypto/secrets.ts";

import type { SupabaseClient } from "@supabase/supabase-js";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

import {
  UnauthorizedError,
  auth,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";

import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

import { checkUrlResolved } from "../ai/web.ts";

import {
  buildIndex,
  formatResult,
  toolInfo,
  type McpServerTools,
  type McpToolInfo,
} from "./shape.ts";


// ==========================================
// TALKING TO AN MCP SERVER
// ==========================================
//
// Everything that reaches a server goes through
// here: connecting, signing in, listing tools,
// calling one. The sign-in state lives in the
// mcp_servers row, so it survives between the
// request that starts a sign-in and the one the
// browser comes back on - and so the background
// worker can use a connection somebody made in
// the browser.
//

export type McpServerRow = {
  id: string;
  user_id: string;
  catalog_id: string | null;
  name: string;
  url: string;
  transport: "http" | "sse";
  auth_type: "oauth" | "token" | "none";
  status: "pending" | "connected" | "error";
  error: string | null;
  access_token: string | null;
  // Sealed in the database; see lib/crypto/secrets.ts.
  // Only RowAuthProvider opens them.
  oauth_client: unknown;
  oauth_tokens: unknown;
  oauth_discovery: OAuthDiscoveryState | null;
  code_verifier: string | null;
  oauth_state: string | null;
  redirect_url: string | null;
  tools: McpToolInfo[];
  enabled: boolean;
};

const TABLE = "mcp_servers";

const CALL_TIMEOUT_MS = 60_000;


// ------------------------------------------
// EVERY REQUEST IS CHECKED
// ------------------------------------------
//
// A server's sign-in metadata names other
// addresses - where to register, where to get a
// token - and a hostile one could name this
// machine's own network. So every request the
// SDK makes, not just the first, has to pass the
// same check the web tool uses.
//

const guardedFetch: typeof fetch = async (input, init) => {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

  const { url, error } = await checkUrlResolved(raw);

  if (!url || url.protocol !== "https:") {
    throw new Error(
      error ??
        "MCP servers are only reached over https."
    );
  }

  return fetch(input, init);
};


// ------------------------------------------
// SIGN-IN STATE, KEPT IN THE ROW
// ------------------------------------------

class RowAuthProvider implements OAuthClientProvider {
  authorizeUrl: URL | null = null;

  // Plain fields rather than constructor
  // shorthand: the worker runs this file with
  // Node's type stripping, which does not
  // support it.

  private db: SupabaseClient;

  private row: McpServerRow;

  constructor(db: SupabaseClient, row: McpServerRow) {
    this.db = db;
    this.row = row;
  }

  get redirectUrl() {
    return this.row.redirect_url ?? undefined;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Teamski",
      redirect_uris: this.row.redirect_url
        ? [this.row.redirect_url]
        : [],
      grant_types: [
        "authorization_code",
        "refresh_token",
      ],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  state() {
    return this.row.oauth_state ?? "";
  }

  clientInformation() {
    return (
      openJson<OAuthClientInformationMixed>(
        this.row.oauth_client
      ) ?? undefined
    );
  }

  async saveClientInformation(
    info: OAuthClientInformationMixed
  ) {
    const sealed = sealJson(info);
    this.row.oauth_client = sealed;
    await this.save({ oauth_client: sealed });
  }

  tokens() {
    return (
      openJson<OAuthTokens>(this.row.oauth_tokens) ??
      undefined
    );
  }

  async saveTokens(tokens: OAuthTokens) {
    const sealed = sealJson(tokens);
    this.row.oauth_tokens = sealed;
    await this.save({ oauth_tokens: sealed });
  }

  // Nothing to redirect from on a server. The
  // address is handed back to whoever asked, and
  // the browser goes there.

  redirectToAuthorization(url: URL) {
    this.authorizeUrl = url;
  }

  async saveCodeVerifier(verifier: string) {
    const sealed = sealSecret(verifier);
    this.row.code_verifier = sealed;
    await this.save({ code_verifier: sealed });
  }

  codeVerifier() {
    const verifier = openSecret(this.row.code_verifier);

    if (!verifier) {
      throw new Error("No sign-in is in progress.");
    }

    return verifier;
  }

  discoveryState() {
    return this.row.oauth_discovery ?? undefined;
  }

  async saveDiscoveryState(
    state: OAuthDiscoveryState
  ) {
    this.row.oauth_discovery = state;
    await this.save({ oauth_discovery: state });
  }

  async invalidateCredentials(
    scope:
      | "all"
      | "client"
      | "tokens"
      | "verifier"
      | "discovery"
  ) {
    const patch: Partial<McpServerRow> = {};

    if (scope === "all" || scope === "client") {
      patch.oauth_client = null;
    }

    if (scope === "all" || scope === "tokens") {
      patch.oauth_tokens = null;
    }

    if (scope === "all" || scope === "verifier") {
      patch.code_verifier = null;
    }

    if (scope === "all" || scope === "discovery") {
      patch.oauth_discovery = null;
    }

    Object.assign(this.row, patch);

    await this.save(patch);
  }

  private async save(patch: Partial<McpServerRow>) {
    await this.db
      .from(TABLE)
      .update({
        ...patch,
        updated_at: new Date().toISOString(),
      })
      .eq("id", this.row.id);
  }
}


// ------------------------------------------
// CONNECTING
// ------------------------------------------

type Opened =
  | { client: Client; authorizeUrl?: undefined }
  | { client?: undefined; authorizeUrl: string };

async function open(
  db: SupabaseClient,
  row: McpServerRow
): Promise<Opened> {
  const provider =
    row.auth_type === "oauth"
      ? new RowAuthProvider(db, row)
      : undefined;

  const token =
    row.auth_type === "token"
      ? openSecret(row.access_token)
      : null;

  const options = {
    authProvider: provider,
    fetch: guardedFetch,

    requestInit: token
      ? {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      : undefined,
  };

  const url = new URL(row.url);

  const transport =
    row.transport === "sse"
      ? new SSEClientTransport(url, options)
      : new StreamableHTTPClientTransport(
          url,
          options
        );

  const client = new Client({
    name: "teamski",
    version: "1.0.0",
  });

  try {
    await client.connect(transport);

    return { client };
  } catch (error) {
    if (provider?.authorizeUrl) {
      return {
        authorizeUrl: provider.authorizeUrl.toString(),
      };
    }

    if (error instanceof UnauthorizedError) {
      throw new Error(
        row.auth_type === "token"
          ? `${row.name} rejected that token.`
          : `${row.name} needs you to sign in again.`
      );
    }

    throw error;
  }
}


async function setStatus(
  db: SupabaseClient,
  id: string,
  patch: Record<string, unknown>
) {
  await db
    .from(TABLE)
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}


// Asks the server what it offers and keeps the
// answer. Returns where to sign in instead, when
// that has to happen first.

export async function refreshTools(
  db: SupabaseClient,
  row: McpServerRow
): Promise<
  | { tools: McpToolInfo[]; authorizeUrl?: undefined }
  | { tools?: undefined; authorizeUrl: string }
> {
  let opened: Opened;

  try {
    opened = await open(db, row);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : `Could not reach ${row.name}.`;

    await setStatus(db, row.id, {
      status: "error",
      error: message,
    });

    throw new Error(message);
  }

  if (!opened.client) {
    return { authorizeUrl: opened.authorizeUrl };
  }

  try {
    const tools: McpToolInfo[] = [];

    let cursor: string | undefined;

    // Paged, and bounded, in case a server keeps
    // handing back a cursor.

    for (let page = 0; page < 10; page++) {
      const result = await opened.client.listTools(
        cursor ? { cursor } : undefined,
        { timeout: CALL_TIMEOUT_MS }
      );

      tools.push(...result.tools.map(toolInfo));

      cursor = result.nextCursor;

      if (!cursor) {
        break;
      }
    }

    await setStatus(db, row.id, {
      status: "connected",
      error: null,
      tools,
      tools_fetched_at: new Date().toISOString(),
      oauth_state: null,
      code_verifier: null,
    });

    return { tools };
  } finally {
    await opened.client.close().catch(() => {});
  }
}


// The browser came back from signing in with a
// code. Trade it for tokens, then see what the
// server offers.

export async function finishSignIn(
  db: SupabaseClient,
  row: McpServerRow,
  code: string
) {
  await auth(new RowAuthProvider(db, row), {
    serverUrl: row.url,
    authorizationCode: code,
    fetchFn: guardedFetch,
  });

  return refreshTools(db, row);
}


// ------------------------------------------
// CALLING A TOOL
// ------------------------------------------

export async function callTool(
  db: SupabaseClient,
  userId: string,
  serverId: string,
  tool: string,
  args: Record<string, unknown>
) {
  // Loaded by id *and* owner. The worker reads
  // with the service role, so row level security
  // is not there to stop one person's run using
  // somebody else's Notion.

  const { data } = await db
    .from(TABLE)
    .select("*")
    .eq("id", serverId)
    .eq("user_id", userId)
    .maybeSingle();

  const row = data as McpServerRow | null;

  if (!row || !row.enabled) {
    throw new Error(
      "That app is no longer connected."
    );
  }

  const opened = await open(db, row);

  if (!opened.client) {
    await setStatus(db, row.id, {
      status: "error",
      error: "Needs you to sign in again.",
    });

    throw new Error(
      `${row.name} needs you to sign in again, in Settings → Connections.`
    );
  }

  try {
    const result = await opened.client.callTool(
      { name: tool, arguments: args },
      undefined,
      { timeout: CALL_TIMEOUT_MS }
    );

    // Older servers answer with toolResult rather
    // than content.

    const shaped = result as {
      content?: unknown;
      structuredContent?: unknown;
      isError?: boolean;
      toolResult?: unknown;
    };

    return formatResult(row.name, {
      content: shaped.content,
      isError: shaped.isError,
      structuredContent:
        shaped.structuredContent ?? shaped.toolResult,
    });
  } finally {
    await opened.client.close().catch(() => {});
  }
}


// ------------------------------------------
// WHAT TO OFFER THE MODEL THIS TURN
// ------------------------------------------
//
// From the kept tool lists, so a chat turn does
// not open a connection to every server just to
// find out what it could do.
//

export async function mcpToolsFor(
  db: SupabaseClient,
  userId: string
) {
  const { data, error } = await db
    .from(TABLE)
    .select("id, name, catalog_id, tools")
    .eq("user_id", userId)
    .eq("status", "connected")
    .eq("enabled", true)
    .order("created_at", { ascending: true });

  // No table yet means no apps.

  if (error || !data) {
    return buildIndex([]);
  }

  return buildIndex(data as McpServerTools[]);
}
