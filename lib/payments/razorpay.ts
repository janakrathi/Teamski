import crypto from "crypto";


// ==========================================
// RAZORPAY
// ==========================================
//
// Payments run through Razorpay's REST API - no SDK,
// just fetch and a couple of HMAC checks. Three
// secrets live in the environment:
//
//   RAZORPAY_KEY_ID          public-ish, sent to the
//                            browser's checkout
//   RAZORPAY_KEY_SECRET      signs orders; never
//                            leaves the server
//   RAZORPAY_WEBHOOK_SECRET  signs webhook calls
//
// Test keys (rzp_test_...) behave the same as live
// ones but only take test cards, so the whole flow
// can be built and checked before real money moves.
//

const API = "https://api.razorpay.com/v1";


export function razorpayKeyId() {
  return process.env.RAZORPAY_KEY_ID || null;
}

function razorpaySecret() {
  return process.env.RAZORPAY_KEY_SECRET || null;
}

function webhookSecret() {
  return process.env.RAZORPAY_WEBHOOK_SECRET || null;
}


// Whether the server can take a payment at all, so
// the app can decide without knowing the details.

export function paymentsConfigured() {
  return Boolean(razorpayKeyId() && razorpaySecret());
}


export type RazorpayOrder = {
  id: string;
  amount: number;
  currency: string;
  notes?: Record<string, string>;
};


// A Razorpay order is the amount to be paid, created
// server-side so the browser can never set its own
// price. `notes` carries which project and owner it
// is for, and is read back - trusted - when the
// payment is confirmed.

export async function createOrder(options: {
  amountPaise: number;
  receipt: string;
  notes: Record<string, string>;
}): Promise<
  { order: RazorpayOrder } | { error: string }
> {
  const id = razorpayKeyId();
  const secret = razorpaySecret();

  if (!id || !secret) {
    return { error: "not-configured" };
  }

  const auth = Buffer.from(
    `${id}:${secret}`
  ).toString("base64");

  try {
    const response = await fetch(`${API}/orders`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: options.amountPaise,
        currency: "INR",
        receipt: options.receipt,
        notes: options.notes,
      }),
    });

    if (!response.ok) {
      const text = await response
        .text()
        .catch(() => "");

      return {
        error: `${response.status}${
          text ? `: ${text.slice(0, 200)}` : ""
        }`,
      };
    }

    return {
      order: (await response.json()) as RazorpayOrder,
    };
  } catch (cause) {
    return {
      error:
        cause instanceof Error
          ? cause.message
          : "could not reach Razorpay",
    };
  }
}


// One order, read back after payment to learn which
// project it was for - the amount and notes come
// from Razorpay, not from the browser.

export async function getOrder(
  orderId: string
): Promise<RazorpayOrder | null> {
  const id = razorpayKeyId();
  const secret = razorpaySecret();

  if (!id || !secret) {
    return null;
  }

  const auth = Buffer.from(
    `${id}:${secret}`
  ).toString("base64");

  try {
    const response = await fetch(
      `${API}/orders/${orderId}`,
      {
        headers: { Authorization: `Basic ${auth}` },
      }
    );

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as RazorpayOrder;
  } catch {
    return null;
  }
}


function safeEqual(a: string, b: string) {
  const one = Buffer.from(a);
  const two = Buffer.from(b);

  return (
    one.length === two.length &&
    crypto.timingSafeEqual(one, two)
  );
}


// The browser hands back order id, payment id and a
// signature; a real payment is one whose signature is
// HMAC(order|payment) under the secret. Anything else
// is forged and refused.

export function verifyPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string
) {
  const secret = razorpaySecret();

  if (!secret) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  return safeEqual(expected, signature);
}


// A webhook is genuine when its body is HMAC-signed
// under the webhook secret. Verified against the raw
// body, before parsing, so a re-serialised copy
// cannot slip through.

export function verifyWebhookSignature(
  rawBody: string,
  signature: string
) {
  const secret = webhookSecret();

  if (!secret) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  return safeEqual(expected, signature);
}
