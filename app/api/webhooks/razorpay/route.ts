import { adminClient } from "@/lib/supabase/admin";

import {
  getOrder,
  verifyWebhookSignature,
} from "@/lib/payments/razorpay";

import { activateTeam } from "@/lib/payments/subscription";

export const dynamic = "force-dynamic";


// ==========================================
// RAZORPAY WEBHOOK
// ==========================================
//
// The authority on whether money arrived. Razorpay
// calls this directly, so it takes no login - instead
// every call is checked against the webhook secret,
// and an unsigned or wrongly-signed one is refused.
//
// It upgrades the project named in the order's notes,
// and does so idempotently, so it is safe if it fires
// more than once or races the browser's confirmation.
//
// Configure in the Razorpay dashboard (Webhooks) to
// send `order.paid` (and `payment.captured`) to
// /api/webhooks/razorpay with the same secret.
//

export async function POST(request: Request) {
  // The raw body, for the signature - not the parsed
  // object, which would be a re-serialised copy.
  const raw = await request.text();

  const signature =
    request.headers.get("x-razorpay-signature") ?? "";

  if (!verifyWebhookSignature(raw, signature)) {
    return new Response("bad signature", {
      status: 400,
    });
  }

  let event: {
    event?: string;
    payload?: {
      order?: {
        entity?: {
          id?: string;
          notes?: Record<string, string>;
        };
      };
      payment?: {
        entity?: {
          order_id?: string;
          notes?: Record<string, string>;
        };
      };
    };
  };

  try {
    event = JSON.parse(raw);
  } catch {
    return new Response("bad body", { status: 400 });
  }

  // Find the order and its notes, whichever event
  // this is. order.paid carries the notes directly;
  // payment.captured carries only the order id, so
  // the order is read back for them.
  const orderEntity = event.payload?.order?.entity;

  let orderId = orderEntity?.id ?? "";
  let notes = orderEntity?.notes;

  if (!orderId) {
    const paymentEntity =
      event.payload?.payment?.entity;

    orderId = paymentEntity?.order_id ?? "";

    if (orderId) {
      notes =
        (await getOrder(orderId))?.notes ??
        paymentEntity?.notes;
    }
  }

  const projectId = notes?.projectId ?? "";
  const ownerId = notes?.ownerId ?? "";

  // An event we do not act on (or one without our
  // notes) is still acknowledged, so Razorpay does
  // not retry it forever.
  if (!orderId || !projectId || !ownerId) {
    return new Response("ignored", { status: 200 });
  }

  const admin = adminClient();

  if (!admin) {
    // Ask Razorpay to retry - the server could not
    // record it right now.
    return new Response("no service role", {
      status: 500,
    });
  }

  const result = await activateTeam(admin, {
    projectId,
    ownerId,
    orderId,
    currency: notes?.shownCurrency,
    members: Number(notes?.members) || undefined,
  });

  if (!result.ok) {
    return new Response(result.error, {
      status: 500,
    });
  }

  return new Response("ok", { status: 200 });
}
