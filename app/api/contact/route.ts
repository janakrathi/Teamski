import { SELF_HOSTED } from "@/lib/plans";

import { cleanContact, type ContactMessage } from "@/lib/contact";

import { sheetSafe } from "@/lib/enterprise";

import { sendEmail } from "@/lib/email/send";

import { contactMessageEmail } from "@/lib/email/templates";


// ==========================================
// CONTACT US
// ==========================================
//
// The front page's "Contact us" form. A message goes
// to the same Google Sheet as Contact sales, on its
// own "Contact" tab (scripts/enterprise-sheet.gs), and
// to the admins' inbox as a backup. It only fails if
// neither worked.
//
// Signed out and public, so it is rate limited
// tightly (lib/rate-limit.ts) and a hidden field
// catches bots.
//

async function toSheet(message: ContactMessage) {
  const url = process.env.ENTERPRISE_SHEET_URL;

  if (!url) {
    return false;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: process.env.ENTERPRISE_SHEET_SECRET ?? "",
        kind: "contact",
        submittedAt: new Date().toISOString(),
        name: sheetSafe(message.name),
        email: sheetSafe(message.email),
        topic: sheetSafe(message.topic),
        message: sheetSafe(message.message),
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
        "Contact message not written to the sheet:",
        response.status,
        body.error
      );

      return false;
    }

    return true;
  } catch (error) {
    console.error("Contact message not written to the sheet:", error);

    return false;
  }
}


async function toInbox(message: ContactMessage) {
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
    const result = await sendEmail(contactMessageEmail({ to, site, message }));

    delivered ||= result.sent;
  }

  return delivered;
}


export async function POST(request: Request) {
  if (SELF_HOSTED) {
    return Response.json(
      { error: "The contact form is off on a self-hosted copy." },
      { status: 404 }
    );
  }

  let input: Record<string, unknown>;

  try {
    input = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "That form did not arrive." }, { status: 400 });
  }

  // Only a bot fills the hidden field. Say yes and
  // keep nothing.
  if (typeof input.website === "string" && input.website.trim()) {
    return Response.json({ ok: true });
  }

  const checked = cleanContact(input);

  if (!checked.ok) {
    return Response.json({ error: checked.error }, { status: 400 });
  }

  const [sheet, inbox] = await Promise.all([
    toSheet(checked.message),
    toInbox(checked.message),
  ]);

  if (!sheet && !inbox) {
    return Response.json(
      { error: "We couldn't send that just now. Please try again in a minute." },
      { status: 503 }
    );
  }

  return Response.json({ ok: true });
}
