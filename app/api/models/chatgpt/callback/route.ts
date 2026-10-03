import { createClient } from "@/lib/supabase/server";

import { chatgptPlanAvailable, originInState } from "@/lib/ai/providers/chatgpt";

import { clearPendingCookie, finishSignIn, readPending } from "@/lib/ai/chatgpt-connect";

export const dynamic = "force-dynamic";


// ==========================================
// WHERE CHATGPT SENDS THE BROWSER BACK
// ==========================================
//
// Only used when Teamski runs on this machine: OpenAI
// sends the browser to 127.0.0.1 on Teamski's port. If
// Teamski was opened as localhost, the sign-in cookie
// lives there, so the browser is bounced once to the
// same path on localhost and finished there.
//

function page(title: string, detail: string, status = 200, cookie?: string) {
  const escape = (text: string) =>
    text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(
      title
    )}</title><body style="font:15px system-ui,sans-serif;background:#0b0b0c;color:#e8e8ea;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px"><div style="max-width:420px"><h1 style="font-size:18px;margin:0 0 8px">${escape(
      title
    )}</h1><p style="color:#a1a1aa;line-height:1.5;margin:0">${escape(detail)}</p></div></body>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        ...(cookie ? { "set-cookie": cookie } : {}),
      },
    }
  );
}

export async function GET(request: Request) {
  if (!chatgptPlanAvailable()) {
    return page("Not available", "Connecting a ChatGPT plan is available on self-hosted Teamski.", 403);
  }

  const here = new URL(request.url);

  const pending = readPending(request);

  if (!pending) {
    const origin = originInState(here.searchParams.get("state") ?? "");

    if (origin && origin !== here.origin) {
      return Response.redirect(`${origin}${here.pathname}${here.search}`, 302);
    }

    return page("Sign-in expired", "Start again from Settings, under Models.", 400);
  }

  const db = await createClient();

  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    return page("Not signed in", "Sign in to Teamski, then connect ChatGPT again from Settings.", 401);
  }

  const result = await finishSignIn({
    db,
    userId: user.id,
    pending,
    callbackUrl: request.url,
  });

  return result.ok
    ? page(
        "ChatGPT connected",
        `Your plan${result.email ? ` (${result.email})` : ""} now answers in Teamski. You can close this tab.`,
        200,
        clearPendingCookie()
      )
    : page("Couldn't connect ChatGPT", result.error, 400);
}
