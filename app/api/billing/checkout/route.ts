import { createClient } from "@/lib/supabase/server";

import { adminClient } from "@/lib/supabase/admin";

import {
  DEFAULT_CURRENCY,
  asCurrency,
  can,
  teamMonthlyPriceINR,
  type ProjectRole,
  SELF_HOSTED,
} from "@/lib/plans";

import {
  createOrder,
  paymentsConfigured,
  razorpayKeyId,
} from "@/lib/payments/razorpay";

export const dynamic = "force-dynamic";


// ==========================================
// START A CHECKOUT
// ==========================================
//
// Creates a Razorpay order for a project's Team plan
// and hands the browser what it needs to open the
// checkout. It never grants the plan - that happens
// only once the payment is confirmed (verify) or the
// webhook arrives. The amount is decided here, from
// the project's own member count, so the browser
// cannot set its own price.
//

export async function POST(request: Request) {
  if (SELF_HOSTED) {
    return Response.json(
      { error: "Payments are off on a self-hosted copy: every project already has everything." },
      { status: 404 }
    );
  }

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

  if (!paymentsConfigured()) {
    return Response.json(
      {
        error:
          "Payments are not switched on yet. Nothing has been charged.",
        notConfigured: true,
      },
      { status: 501 }
    );
  }

  const body = (await request
    .json()
    .catch(() => ({}))) as {
    projectId?: string;
    currency?: string;
  };

  const projectId = (body.projectId ?? "").trim();

  if (!projectId) {
    return Response.json(
      { error: "Which project are you upgrading?" },
      { status: 400 }
    );
  }

  // Only the owner may pay for a project - it is
  // their bill. Read their own membership, so RLS
  // keeps it honest.
  const { data: membership } = await db
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  const role =
    (membership?.role as ProjectRole | undefined) ??
    null;

  if (!can(role, "manage_billing")) {
    return Response.json(
      {
        error:
          "Only the project owner can upgrade it.",
      },
      { status: 403 }
    );
  }

  const admin = adminClient() ?? db;

  // The price follows the project's size. Counted
  // here, not sent by the browser.
  const { count } = await admin
    .from("project_members")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId);

  const members = count ?? 1;

  const currency =
    asCurrency(body.currency ?? DEFAULT_CURRENCY) ??
    DEFAULT_CURRENCY;

  const rupees = teamMonthlyPriceINR(
    members,
    currency
  );

  const result = await createOrder({
    amountPaise: rupees * 100,
    receipt: `team_${projectId.slice(0, 8)}_${Date.now()}`,
    notes: {
      projectId,
      ownerId: user.id,
      members: String(members),
      shownCurrency: currency,
    },
  });

  if ("error" in result) {
    return Response.json(
      {
        error:
          "Could not start checkout. Nothing has been charged.",
      },
      { status: 502 }
    );
  }

  return Response.json({
    orderId: result.order.id,
    amount: result.order.amount,
    currency: result.order.currency,
    keyId: razorpayKeyId(),
    members,
  });
}
