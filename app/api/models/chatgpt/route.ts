import { createClient } from "@/lib/supabase/server";

import { chatgptPlanAvailable, startSignIn } from "@/lib/ai/providers/chatgpt";

import {
  clearPendingCookie,
  finishSignIn,
  pendingCookie,
  readPending,
  savedClientId,
} from "@/lib/ai/chatgpt-connect";

export const dynamic = "force-dynamic";

function originOf(value: string | undefined) {
  try {
    const url = new URL(value ?? "");

    return /^https?:$/.test(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}


// ==========================================
// CONNECTING A CHATGPT PLUS OR PRO PLAN
// ==========================================
//
// POST { action: "start" } - where to send the
// browser, and whether the address it ends on has to
// be pasted back (Teamski not on this machine).
//
// POST { action: "finish", url } - that pasted
// address. When Teamski is on this machine the
// callback route finishes on its own instead.
//

export async function POST(request: Request) {
  if (!chatgptPlanAvailable()) {
    return Response.json(
      { error: "Connecting a ChatGPT plan is available on self-hosted Teamski." },
      { status: 403 }
    );
  }

  const db = await createClient();

  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    return Response.json({ error: "You must be logged in." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    url?: string;
    origin?: string;
  };

  if (body.action === "start") {
    // The address the person has Teamski open at, from
    // their browser: behind a proxy the request's own
    // URL can be an internal one.
    const origin = originOf(body.origin) ?? new URL(request.url).origin;

    const { url, pending, paste } = startSignIn({
      appOrigin: origin,
      clientId: await savedClientId(db, user.id),
    });

    return Response.json(
      { url, paste },
      {
        headers: {
          "set-cookie": pendingCookie(pending, origin.startsWith("https:")),
        },
      }
    );
  }

  if (body.action === "finish") {
    const result = await finishSignIn({
      db,
      userId: user.id,
      pending: readPending(request),
      callbackUrl: body.url ?? "",
    });

    return Response.json(result, {
      status: result.ok ? 200 : 400,
      headers: result.ok ? { "set-cookie": clearPendingCookie() } : undefined,
    });
  }

  return Response.json({ error: "Unknown action." }, { status: 400 });
}
