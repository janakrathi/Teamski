import { sealSecret } from "@/lib/crypto/secrets";

import { createClient } from "@/lib/supabase/server";

import { adminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";

import { PRESETS, presetById } from "@/lib/ai/providers";

import { ANTHROPIC_MODELS } from "@/lib/ai/providers/anthropic";

import { OPENAI_MODELS } from "@/lib/ai/providers/openai";

import {
  PLAN_LABELS,
  allows,
  can,
  planFor,
  projectOwnerPlan,
  type ProjectRole,
} from "@/lib/plans";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};


// ==========================================
// A KEY THE PROJECT SHARES
// ==========================================
//
// The rung a company actually wants. A design
// team will not each open an Anthropic account -
// somebody buys one key, everyone in the project
// draws on it, and the bill goes to one place.
//
// Members may spend it and may not read it. The
// row is only ever read with the service role,
// and no response here contains a token.
//

const LABELS: Record<string, string> = {
  anthropic: "Anthropic Claude",
  openai: "OpenAI ChatGPT",
};


function labelFor(service: string) {
  return (
    LABELS[service] ??
    presetById(service)?.label ??
    service
  );
}


async function mayManageKeys(
  db: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  userId: string
) {
  const { data } = await db
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  return can(
    data?.role as ProjectRole | undefined,
    "manage_connections"
  );
}


export async function GET(
  _request: Request,
  context: RouteContext
) {
  const { id: projectId } = await context.params;

  const db = await createClient();

  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    return Response.json(
      { error: "You must be logged in." },
      { status: 401 }
    );
  }

  // Membership decides who may see that a shared
  // key exists. The service role does the read,
  // because the policy on that table refuses
  // everyone but the person who added it - which
  // is the point.

  const { data: membership } = await db
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return Response.json(
      {
        error:
          "You are not a member of this project.",
      },
      { status: 403 }
    );
  }

  const admin = adminClient();

  type KeyRow = {
    service: string;
    label: string | null;
    models: unknown;
    monthly_limit_usd: number | null;
  };

  const { data, error } = (admin
    ? await admin
        .from("project_model_keys")
        .select(
          "service, label, models, monthly_limit_usd, created_at"
        )
        .eq("project_id", projectId)
    : { data: [] as KeyRow[], error: null }) as {
    data: KeyRow[] | null;
    error: { code?: string; message: string } | null;
  };

  if (error) {
    if (
      error.code === "42P01" ||
      error.code === "PGRST205"
    ) {
      return Response.json({
        keys: [],
        canManage: can(membership.role as ProjectRole, "manage_connections"),
        needsMigration: true,
      });
    }

    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return Response.json({
    keys: (data ?? []).map((row) => ({
      service: row.service,
      label: row.label ?? labelFor(row.service),

      models: Array.isArray(row.models)
        ? row.models.length
        : 0,

      limit: row.monthly_limit_usd
        ? Number(row.monthly_limit_usd)
        : null,
    })),

    canManage: can(membership.role as ProjectRole, "manage_connections"),

    // Whether the owner's plan lets these keys be
    // used at all. Saved keys stay listed either
    // way, so they can be removed.
    allowed: allows(
      await projectOwnerPlan(admin ?? db, projectId),
      "shared_keys"
    ),

    requiredPlan: PLAN_LABELS[planFor("shared_keys")],

    services: [
      { id: "anthropic", label: labelFor("anthropic") },
      { id: "openai", label: labelFor("openai") },

      ...PRESETS.filter(
        (preset) => !preset.selfHosted
      ).map((preset) => ({
        id: preset.id,
        label: preset.label,
      })),
    ],
  });
}


export async function POST(
  request: Request,
  context: RouteContext
) {
  const { id: projectId } = await context.params;

  const db = await createClient();

  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    return Response.json(
      { error: "You must be logged in." },
      { status: 401 }
    );
  }

  if (!(await mayManageKeys(db, projectId, user.id))) {
    return Response.json(
      {
        error:
          "Only an owner or admin can add a shared key.",
      },
      { status: 403 }
    );
  }

  const admin = adminClient() ?? db;

  // The project's own plan decides whether it may
  // have a shared key - the owner's bill, whoever
  // added it.

  if (
    !allows(
      await projectOwnerPlan(admin, projectId),
      "shared_keys"
    )
  ) {
    return Response.json(
      {
        error: `Sharing a key with the whole project is part of ${
          PLAN_LABELS[planFor("shared_keys")]
        }.`,
        upgrade: planFor("shared_keys"),
      },
      { status: 403 }
    );
  }

  const body = (await request
    .json()
    .catch(() => ({}))) as {
    service?: string;
    key?: string;
    models?: string;

    // Dollars a month. Absent means no ceiling,
    // which is the honest default - a limit
    // somebody did not choose would stop their
    // work at a number they never saw.
    limit?: string | number | null;
  };

  const service = (body.service ?? "").trim();

  const key = (body.key ?? "").trim();

  if (!service || !key) {
    return Response.json(
      { error: "A service and a key are needed." },
      { status: 400 }
    );
  }

  // A ChatGPT plan belongs to one person and is never
  // shared with a project.
  if (service === "chatgpt") {
    return Response.json(
      { error: "A ChatGPT plan can only be connected by its owner, for themselves." },
      { status: 400 }
    );
  }

  const preset = presetById(service);

  const typed = (body.models ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((id) => ({ id, label: id }));

  const models =
    typed.length > 0
      ? typed
      : service === "anthropic"
        ? ANTHROPIC_MODELS
        : service === "openai"
          ? OPENAI_MODELS
          : (preset?.suggested ?? []);

  const { error } = await admin
    .from("project_model_keys")
    .upsert(
      {
        project_id: projectId,
        service,
        label: labelFor(service),
        access_token: sealSecret(key),
        base_url: preset?.baseUrl ?? null,
        models,

        monthly_limit_usd:
          body.limit === null ||
          body.limit === undefined ||
          body.limit === ""
            ? null
            : Number(body.limit) || null,

        added_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id,service" }
    );

  if (error) {
    if (
      error.code === "42P01" ||
      error.code === "PGRST205"
    ) {
      return Response.json(
        {
          error:
            "Run supabase/migrations/0016_shared_keys.sql first.",
          needsMigration: true,
        },
        { status: 400 }
      );
    }

    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }

  await audit({
    projectId,
    actorId: user.id,
    action: "key.add",
    target: labelFor(service),
  });

  return Response.json({ ok: true });
}


export async function DELETE(
  request: Request,
  context: RouteContext
) {
  const { id: projectId } = await context.params;

  const db = await createClient();

  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    return Response.json(
      { error: "You must be logged in." },
      { status: 401 }
    );
  }

  if (!(await mayManageKeys(db, projectId, user.id))) {
    return Response.json(
      {
        error:
          "Only an owner or admin can remove a shared key.",
      },
      { status: 403 }
    );
  }

  const admin = adminClient() ?? db;

  const service =
    new URL(request.url).searchParams.get(
      "service"
    ) ?? "";

  const { error } = await admin
    .from("project_model_keys")
    .delete()
    .eq("project_id", projectId)
    .eq("service", service);

  if (error) {
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }

  await audit({
    projectId,
    actorId: user.id,
    action: "key.remove",
    target: labelFor(service),
  });

  return Response.json({ ok: true });
}
