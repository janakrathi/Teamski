import { SELF_HOSTED } from "@/lib/plans";

import { cleanLead, sheetSafe, type Lead } from "@/lib/enterprise";

import { sendEmail } from "@/lib/email/send";

import { enterpriseLeadEmail } from "@/lib/email/templates";

import { metaUserFromRequest, sendMetaEvents } from "@/lib/analytics/capi";


// ==========================================
// CONTACT SALES
// ==========================================
//
// The Enterprise card's form posts here, signed in or
// not. A lead goes two places so it is never lost:
//
//   a Google Sheet   through an Apps Script web app
//                    (ENTERPRISE_SHEET_URL), guarded by
//                    a shared secret the script checks
//                    (ENTERPRISE_SHEET_SECRET)
//   an email         to ENTERPRISE_NOTIFY_EMAILS, or
//                    ADMIN_EMAILS, with reply-to set to
//                    the person who asked
//
// Either one landing is a success; both failing is the
// only error the visitor sees. The rate limit lives in
// lib/rate-limit.ts.
//


async function toSheet(lead: Lead) {
  const url = process.env.ENTERPRISE_SHEET_URL;

  if (!url) {
    return false;
  }

  try {
    // Apps Script answers a POST with a redirect to
    // its output; fetch follows it, and the row is
    // already written by then.
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: process.env.ENTERPRISE_SHEET_SECRET ?? "",
        submittedAt: new Date().toISOString(),
        name: sheetSafe(lead.name),
        email: sheetSafe(lead.email),
        company: sheetSafe(lead.company),
        role: sheetSafe(lead.role),
        teamSize: sheetSafe(lead.teamSize),
        phone: sheetSafe(lead.phone),
        country: sheetSafe(lead.country),
        needs: sheetSafe(lead.needs),
      }),
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });

    const body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };

    if (!response.ok || !body.ok) {
      console.error(
        "Enterprise lead not written to the sheet:",
        response.status,
        body.error
      );

      return false;
    }

    return true;
  } catch (error) {
    console.error("Enterprise lead not written to the sheet:", error);

    return false;
  }
}


async function toInbox(lead: Lead) {
  const recipients = (
    process.env.ENTERPRISE_NOTIFY_EMAILS ||
    process.env.ADMIN_EMAILS ||
    ""
  )
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://teamski.in";

  let delivered = false;

  for (const to of recipients) {
    const result = await sendEmail(enterpriseLeadEmail({ to, site, lead }));

    delivered ||= result.sent;
  }

  return delivered;
}


// The enquiry as a Lead, server to Meta, for ad
// measurement - the copy that still arrives when an ad
// blocker stopped the pixel. Its outcome never decides
// whether the form "worked".

async function toMeta(lead: Lead, eventId: string, request: Request) {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://teamski.in";

  await sendMetaEvents([
    {
      name: "Lead",
      id: eventId,
      url: `${site}/`,
      user: { ...metaUserFromRequest(request), email: lead.email },
      custom: { content_name: "Enterprise", team_size: lead.teamSize },
    },
  ]);
}


export async function POST(request: Request) {
  if (SELF_HOSTED) {
    return Response.json(
      { error: "Contact sales is off on a self-hosted copy." },
      { status: 404 }
    );
  }

  let input: Record<string, unknown>;

  try {
    input = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "That form did not arrive." }, { status: 400 });
  }

  // A field people never see. A bot fills every box;
  // it gets a success and nothing is stored.
  if (typeof input.website === "string" && input.website.trim()) {
    return Response.json({ ok: true });
  }

  const checked = cleanLead(input);

  if (!checked.ok) {
    return Response.json({ error: checked.error }, { status: 400 });
  }

  // Shared with the pixel's Lead so Meta keeps one; made
  // here if the browser did not send a usable one.
  const eventId =
    typeof input.eventId === "string" &&
    /^[A-Za-z0-9-]{8,80}$/.test(input.eventId)
      ? input.eventId
      : crypto.randomUUID();

  const [sheet, inbox] = await Promise.all([
    toSheet(checked.lead),
    toInbox(checked.lead),
    toMeta(checked.lead, eventId, request),
  ]);

  if (!sheet && !inbox) {
    return Response.json(
      {
        error:
          "We couldn't send that just now. Please try again in a minute.",
      },
      { status: 503 }
    );
  }

  return Response.json({ ok: true });
}
