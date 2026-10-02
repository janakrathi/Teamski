import { SELF_HOSTED } from "@/lib/plans";

import { createClient } from "@/lib/supabase/server";

import { adminClient } from "@/lib/supabase/admin";

import {
  getOrder,
  verifyPaymentSignature,
} from "@/lib/payments/razorpay";

import { activateTeam } from "@/lib/payments/subscription";

export const dynamic = "force-dynamic";


// ==========================================
// CONFIRM A PAYMENT
// ==========================================
//
// The browser calls this the moment Razorpay's
// checkout succeeds, so the plan shows as upgraded
// right away. It is not the only path - the webhook
// confirms independently - but it is the fast one.
//
// The plan is written for the project the ORDER was
// made for (read back from Razorpay), never the one
// the browser claims, so a valid payment can only
// ever upgrade the project it was actually for.
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

  const body = (await request
    .json()
    .catch(() => ({}))) as {
    orderId?: string;
    paymentId?: string;
    signature?: string;
  };

  const orderId = (body.orderId ?? "").trim();
  const paymentId = (body.paymentId ?? "").trim();
  const signature = (body.signature ?? "").trim();

  if (!orderId || !paymentId || !signature) {
    return Response.json(
      { error: "Missing payment details." },
      { status: 400 }
    );
  }

  // Forged or altered payments are refused here.
  if (
    !verifyPaymentSignature(
      orderId,
      paymentId,
      signature
    )
  ) {
    return Response.json(
      { error: "That payment could not be verified." },
      { status: 400 }
    );
  }

  const order = await getOrder(orderId);

  const projectId = order?.notes?.projectId ?? "";
  const ownerId = order?.notes?.ownerId ?? "";

  if (!projectId || !ownerId) {
    return Response.json(
      { error: "That order is not one of ours." },
      { status: 400 }
    );
  }

  // The payer must be the project's owner - the same
  // person the order was created for.
  if (ownerId !== user.id) {
    return Response.json(
      { error: "This payment was not started by you." },
      { status: 403 }
    );
  }

  const admin = adminClient();

  if (!admin) {
    return Response.json(
      { error: "The server cannot record the plan right now." },
      { status: 500 }
    );
  }

  const result = await activateTeam(admin, {
    projectId,
    ownerId,
    orderId,
    currency: order?.notes?.shownCurrency,
    members: Number(order?.notes?.members) || undefined,
  });

  if (!result.ok) {
    return Response.json(
      { error: result.error },
      { status: 500 }
    );
  }

  return Response.json({ ok: true, plan: "team" });
}
