import { sealSecret } from "@/lib/crypto/secrets";

import type { NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

import { adminClient } from "@/lib/supabase/admin";

import { checkUrl } from "@/lib/ai/web";

import { CATALOG, catalogEntry } from "@/lib/mcp/catalog";

import {
  refreshTools,
  type McpServerRow,
} from "@/lib/mcp/client";

import {
  PLAN_LABELS,
  allows,
  planFor,
  planForMember,
} from "@/lib/plans";

export const dynamic = "force-dynamic";


// ==========================================
// APPS OVER MCP
// ==========================================
//
// List what can be connected and what is, connect
// one, refresh what it offers, remove it. Tokens
// never leave the server: nothing here returns a
// column that holds one.
//

// Same reasoning as the other connect flows: the
// address the browser comes back to has to be the
// one it left from, which behind a tunnel is not
// the one Next sees.

function publicOrigin(request: NextRequest) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;

  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Fall through to the headers.
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


const PUBLIC_COLUMNS =
  "id, catalog_id, name, url, status, error, tools, enabled, created_at";

type PublicRow = Pick<
  McpServerRow,
  | "id"
  | "catalog_id"
  | "name"
  | "url"
  | "status"
  | "error"
  | "tools"
  | "enabled"
>;


function present(row: PublicRow) {
  const tools = Array.isArray(row.tools) ? row.tools : [];

  return {
    id: row.id,
    catalogId: row.catalog_id,
    name: row.name,
    url: row.url,
    status: row.status,
    error: row.error,
    enabled: row.enabled,

    tools: tools.map((tool) => ({
      name: tool.name,
      title: tool.title ?? tool.name,
      readOnly: tool.readOnly,
    })),
  };
}


async function signedIn() {
  const db = await createClient();

  const {
    data: { user },
  } = await db.auth.getUser();

  return { db, user };
}


function missingTable(error: { code?: string } | null) {
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205"
  );
}


export async function GET(request: NextRequest) {
  const { db, user } = await signedIn();

  if (!user) {
    return Response.json(
      { error: "You must be logged in." },
      { status: 401 }
    );
  }

  const plan = await planForMember({
    db,
    admin: adminClient(),
    userId: user.id,
    projectId:
      request.nextUrl.searchParams.get("projectId"),
  });

  const { data, error } = await db
    .from("mcp_servers")
    .select(PUBLIC_COLUMNS)
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  return Response.json({
    allowed: allows(plan, "apps"),
    customAllowed: allows(plan, "custom_apps"),
    requiredPlan: PLAN_LABELS[planFor("apps")],
    customPlan: PLAN_LABELS[planFor("custom_apps")],

    catalog: CATALOG.map((entry) => ({
      id: entry.id,
      name: entry.name,
      blurb: entry.blurb,
    })),

    servers: ((data ?? []) as PublicRow[]).map(present),

    needsMigration: missingTable(error),
  });
}


// ------------------------------------------
// CONNECT
// ------------------------------------------

export async function POST(request: NextRequest) {
  const { db, user } = await signedIn();

  if (!user) {
    return Response.json(
      { error: "You must be logged in." },
      { status: 401 }
    );
  }

  const body = (await request
    .json()
    .catch(() => ({}))) as {
    catalogId?: string;
    url?: string;
    name?: string;
    token?: string;
    projectId?: string;
  };

  const plan = await planForMember({
    db,
    admin: adminClient(),
    userId: user.id,
    projectId: body.projectId ?? null,
  });

  if (!allows(plan, "apps")) {
    return Response.json(
      {
        error: `Connecting apps is part of ${
          PLAN_LABELS[planFor("apps")]
        }.`,
        upgrade: planFor("apps"),
      },
      { status: 403 }
    );
  }

  // One from the list, or any server by address.

  const entry = body.catalogId
    ? catalogEntry(body.catalogId)
    : undefined;

  if (body.catalogId && !entry) {
    return Response.json(
      { error: "That app is not on the list." },
      { status: 400 }
    );
  }

  if (!entry && !allows(plan, "custom_apps")) {
    return Response.json(
      {
        error: `Connecting a server by its address is part of ${
          PLAN_LABELS[planFor("custom_apps")]
        }.`,
        upgrade: planFor("custom_apps"),
      },
      { status: 403 }
    );
  }

  const address = entry?.url ?? (body.url ?? "").trim();

  const { url, error: badUrl } = checkUrl(address);

  if (!url || url.protocol !== "https:") {
    return Response.json(
      {
        error:
          badUrl ??
          "An MCP server address has to start with https://.",
      },
      { status: 400 }
    );
  }

  const name =
    entry?.name ||
    (body.name ?? "").trim().slice(0, 60) ||
    url.hostname;

  const token = (body.token ?? "").trim();

  const { data, error } = await db
    .from("mcp_servers")
    .upsert(
      {
        user_id: user.id,
        catalog_id: entry?.id ?? null,
        name,
        url: url.toString(),

        // An address ending in /sse is the older
        // transport; everything else is current.
        transport:
          entry?.transport ??
          (url.pathname.endsWith("/sse") ? "sse" : "http"),

        auth_type: token ? "token" : "oauth",
        access_token: sealSecret(token || null),

        status: "pending",
        error: null,

        // A fresh sign-in each time connect is
        // pressed. The state ties the return to
        // this row and this person.
        oauth_state: crypto.randomUUID(),
        code_verifier: null,
        redirect_url: `${publicOrigin(request)}/api/mcp/callback`,

        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,url" }
    )
    .select("*")
    .single();

  if (error || !data) {
    if (missingTable(error)) {
      return Response.json(
        {
          error:
            "Run supabase/migrations/0021_mcp.sql first.",
          needsMigration: true,
        },
        { status: 400 }
      );
    }

    return Response.json(
      { error: error?.message ?? "Could not save that app." },
      { status: 500 }
    );
  }

  try {
    const result = await refreshTools(
      db,
      data as McpServerRow
    );

    if (result.authorizeUrl) {
      return Response.json({
        authorizeUrl: result.authorizeUrl,
      });
    }

    return Response.json({
      ok: true,
      tools: result.tools?.length ?? 0,
    });
  } catch (cause) {
    return Response.json(
      {
        error:
          cause instanceof Error
            ? cause.message
            : `Could not connect to ${name}.`,
      },
      { status: 400 }
    );
  }
}


// ------------------------------------------
// REFRESH, TURN ON OR OFF
// ------------------------------------------

export async function PATCH(request: NextRequest) {
  const { db, user } = await signedIn();

  if (!user) {
    return Response.json(
      { error: "You must be logged in." },
      { status: 401 }
    );
  }

  const body = (await request
    .json()
    .catch(() => ({}))) as {
    id?: string;
    action?: "refresh" | "enable" | "disable";
  };

  const { data } = await db
    .from("mcp_servers")
    .select("*")
    .eq("id", body.id ?? "")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!data) {
    return Response.json(
      { error: "That app is not connected." },
      { status: 404 }
    );
  }

  if (body.action === "enable" || body.action === "disable") {
    await db
      .from("mcp_servers")
      .update({
        enabled: body.action === "enable",
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);

    return Response.json({ ok: true });
  }

  try {
    const result = await refreshTools(
      db,
      data as McpServerRow
    );

    return Response.json(
      result.authorizeUrl
        ? { authorizeUrl: result.authorizeUrl }
        : { ok: true, tools: result.tools?.length ?? 0 }
    );
  } catch (cause) {
    return Response.json(
      {
        error:
          cause instanceof Error
            ? cause.message
            : "Could not refresh.",
      },
      { status: 400 }
    );
  }
}


// ------------------------------------------
// REMOVE
// ------------------------------------------

export async function DELETE(request: NextRequest) {
  const { db, user } = await signedIn();

  if (!user) {
    return Response.json(
      { error: "You must be logged in." },
      { status: 401 }
    );
  }

  const { error } = await db
    .from("mcp_servers")
    .delete()
    .eq("id", request.nextUrl.searchParams.get("id") ?? "")
    .eq("user_id", user.id);

  if (error) {
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return Response.json({ ok: true });
}
