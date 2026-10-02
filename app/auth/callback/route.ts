import {
  NextResponse,
  type NextRequest,
} from "next/server";

import { createClient } from "@/lib/supabase/server";


// ==========================================
// COMING BACK FROM A PROVIDER
// ==========================================
//
// Google, GitHub and Apple all send the browser
// back here with a short-lived code. Trading it
// for a session is the last step of signing in.
//

// ------------------------------------------
// THE ADDRESS THEY ACTUALLY TYPED
// ------------------------------------------
//
// request.url is built from the address the
// server is bound to, not the one the browser
// asked for. Put anything in front - a tunnel, a
// load balancer, any real deployment - and it
// reads https://localhost:3000, so every
// redirect below sends people nowhere. The Host
// header is the one that survives the hop.
//
// NEXT_PUBLIC_SITE_URL wins when it is set,
// because a header the caller controls should
// not decide where an auth code gets sent. Set
// it in production; leave it unset locally,
// where the header is the only thing that knows
// about the tunnel.

function publicOrigin(request: NextRequest) {
  const configured =
    process.env.NEXT_PUBLIC_SITE_URL;

  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // A malformed setting should not take the
      // whole sign-in down.
    }
  }

  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host");

  if (!host) {
    return request.nextUrl.origin;
  }

  const proto =
    request.headers.get("x-forwarded-proto") ??
    request.nextUrl.protocol.replace(":", "");

  return `${proto}://${host}`;
}


export async function GET(request: NextRequest) {
  const url = request.nextUrl;

  const origin = publicOrigin(request);

  const code = url.searchParams.get("code");

  // Where the person was heading before they
  // were asked to sign in. Only ever a path on
  // this site - an absolute URL here would be an
  // open redirect.

  const wanted = url.searchParams.get("next");

  const next =
    wanted &&
    wanted.startsWith("/") &&
    !wanted.startsWith("//")
      ? wanted
      : "/";

  // The provider says no by sending a reason
  // rather than a code.

  const denied =
    url.searchParams.get(
      "error_description"
    ) || url.searchParams.get("error");

  if (denied) {
    return NextResponse.redirect(
      new URL(
        `/login?error=${encodeURIComponent(
          denied
        )}`,
        origin
      )
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL(
        "/login?error=" +
          encodeURIComponent(
            "That sign in did not complete. Try again."
          ),
        origin
      )
    );
  }

  const supabase = await createClient();

  const { error } =
    await supabase.auth.exchangeCodeForSession(
      code
    );

  if (error) {
    return NextResponse.redirect(
      new URL(
        `/login?error=${encodeURIComponent(
          error.message
        )}`,
        origin
      )
    );
  }

  return NextResponse.redirect(
    new URL(next, origin)
  );
}
