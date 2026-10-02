import { createClient } from "@/lib/supabase/server";

import {
  metaUserFromRequest,
  sendMetaEvents,
} from "@/lib/analytics/capi";


// ==========================================
// A SIGNUP, TOLD TO META FROM THE SERVER
// ==========================================
//
// The browser calls this once, when it notices a brand
// new account (components/analytics/MetaPixel.tsx). The
// pixel reports the same signup with the same event id;
// this copy is the one that still arrives when an ad
// blocker stopped the pixel, and Meta keeps one of the
// two.
//
// Only for the signed-in person themselves, and only
// while the account is new, so it cannot be used to
// report anyone else or replay old accounts.
//

const DAY = 24 * 60 * 60 * 1000;


export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const created = Date.parse(user.created_at ?? "");

  if (!created || Date.now() - created > DAY) {
    return Response.json({ ok: true, skipped: "not a new account" });
  }

  // The page it happened on, if it is really one of ours.
  const body = (await request.json().catch(() => ({}))) as { url?: unknown };

  // Meta needs a page for a website event; the site's
  // front door stands in when the browser's is not ours.
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://teamski.in";

  let url = `${site}/`;

  if (typeof body.url === "string") {
    try {
      const parsed = new URL(body.url);

      if (
        parsed.host === new URL(site).host ||
        parsed.host === request.headers.get("host")
      ) {
        url = parsed.toString();
      }
    } catch {
      // Not a URL; keep the front door.
    }
  }

  const result = await sendMetaEvents([
    {
      name: "CompleteRegistration",
      id: `registration-${user.id}`,
      url,
      user: {
        ...metaUserFromRequest(request),
        email: user.email ?? null,
        externalId: user.id,
      },
    },
  ]);

  return Response.json({ ok: true, sent: result.sent });
}
