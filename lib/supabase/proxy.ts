import {
  createServerClient,
} from "@supabase/ssr";

import {
  NextResponse,
  type NextRequest,
} from "next/server";

import {
  clientIp,
  createLimiter,
  floodRuleFor,
  ruleFor,
  type Rule,
} from "@/lib/rate-limit";

import { SELF_HOSTED } from "@/lib/plans";


// One counter for the life of the server process.
// See lib/rate-limit.ts.

const take = createLimiter();


function tooMany(
  rule: Rule,
  retryAfterSeconds: number,
  api: boolean
) {
  const headers = {
    "Retry-After": String(retryAfterSeconds),
  };

  return api
    ? Response.json(
        {
          error: rule.message,
          rateLimited: true,
          retryAfterSeconds,
        },
        { status: 429, headers }
      )
    : new Response(rule.message, {
        status: 429,
        headers,
      });
}


export async function updateSession(
  request: NextRequest
) {

  const path = request.nextUrl.pathname;

  const api = path.startsWith("/api/");

  const ip = clientIp(request.headers);

  // A flood from one address is turned away before
  // it costs a call to Supabase. Signed-in traffic
  // gets a higher ceiling per address, because a
  // whole venue can share one - see lib/rate-limit.ts.

  const floodRule = floodRuleFor(request.headers.get("cookie"));

  const flood = take(floodRule, ip);

  if (!flood.ok) {
    return tooMany(floodRule, flood.retryAfterSeconds, api);
  }

  let response =
    NextResponse.next({
      request,
    });

  const supabase =
    createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },

          setAll(cookiesToSet) {

            cookiesToSet.forEach(
              ({
                name,
                value,
                options,
              }) => {

                request.cookies.set(
                  name,
                  value
                );

                response =
                  NextResponse.next({
                    request,
                  });

                response.cookies.set(
                  name,
                  value,
                  options
                );

              }
            );

          },
        },
      }
    );

  // getUser talks to Supabase and can be
  // trusted. Never gate on the cookie alone -
  // anyone can write one.

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Per person where there is one, so a campus
  // behind a single address is not one budget.

  if (api) {
    const rule = ruleFor(request.method, path);

    if (rule) {
      const result = take(rule, user?.id ?? `ip:${ip}`);

      if (!result.ok) {
        return tooMany(rule, result.retryAfterSeconds, true);
      }
    }
  }

  // Signing in and coming back from a provider
  // both have to work while signed out, and the
  // API answers for itself with a 401 rather
  // than a redirect to a page nobody asked for.

  const open =
    path.startsWith("/login") ||
    path.startsWith("/auth/") ||

    // Google checks these as a stranger, and
    // anyone deciding whether to sign up should
    // be able to read them first.
    path === "/privacy" ||
    path === "/terms" ||
    path === "/security" ||
    path === "/hackathons" ||

    // Shows a visitor only their own tracking status.
    path === "/meta-check" ||
    path === "/welcome" ||

    // The blog is public, for search engines and for
    // anyone reading before they sign up.
    path === "/blog" ||
    path.startsWith("/blog/") ||

    // Crawlers read these signed out; a redirect
    // to /login here means the site is never
    // indexed.
    path === "/robots.txt" ||
    path === "/sitemap.xml" ||

    // Search-engine ownership files (Google's
    // google<hash>.html and the like) are fetched
    // signed out, straight from the root.
    (path.startsWith("/google") &&
      path.endsWith(".html")) ||
    path.startsWith("/api/");

  // The front door. A stranger at teamski.in sees
  // what Teamski is rather than a login box; the
  // address stays "/" so the home page Google
  // checks is the one people type.

  if (!user && path === "/") {
    const welcome = request.nextUrl.clone();

    // A self-hosted copy is somebody's own
    // workspace, not a product to sell: straight to
    // sign-in.

    welcome.pathname = SELF_HOSTED ? "/login" : "/welcome";

    const rewrite = NextResponse.rewrite(welcome);

    // Whatever Supabase set while checking the
    // session still has to reach the browser.

    response.cookies
      .getAll()
      .forEach((cookie) => rewrite.cookies.set(cookie));

    return rewrite;
  }

  if (!user && !open) {
    const login = request.nextUrl.clone();

    login.pathname = "/login";

    // So signing in returns you to the page you
    // were actually trying to reach.

    if (path !== "/") {
      login.searchParams.set(
        "next",
        path + request.nextUrl.search
      );
    }

    return NextResponse.redirect(login);
  }

  // Already signed in? The login page has
  // nothing to offer you.

  if (user && path.startsWith("/login")) {
    const home = request.nextUrl.clone();

    home.pathname = "/";
    home.search = "";

    return NextResponse.redirect(home);
  }

  return response;
}