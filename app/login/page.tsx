import type { Metadata } from "next";

import LoginForm from "./LoginForm";

import { anthropicKey } from "@/lib/ai/providers/anthropic";

import { openaiKey } from "@/lib/ai/providers/openai";


export const metadata: Metadata = {
  title: "Sign in",
  alternates: { canonical: "/login" },
};


// Which providers exist is read on every visit,
// not cached. This page is the only place that
// tells anyone - developer or user - what they
// can sign in with, so it has to be current the
// moment a provider is switched on.
//
// A cache here made the page state that GitHub
// was not enabled while Supabase was already
// saying it was, which is the one thing this
// page must never do.

export const dynamic = "force-dynamic";


// ==========================================
// THE LOGIN PAGE
// ==========================================
//
// Which providers are on is a fact about this
// workspace, not about the person visiting, so
// it is settled here and the page arrives ready.
//
// Working it out in the browser meant every
// visit rendered three sign-in buttons and then
// took them away again, and an unconfigured one
// sent people to a page of raw JSON with no way
// back.
//

// Supabase's names, not the brand names -
// Microsoft is "azure". Order is the order they
// appear on the page.

// Apple, Facebook and phone are gone: Apple
// costs 99 dollars a year, Facebook needs
// business verification and a review, and every
// SMS costs money. None were ever going to be
// switched on.

const ALL = ["google", "azure", "github"];

async function waysIn() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

  const key =
    process.env
      .NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    return { providers: [] };
  }


  try {
    const response = await fetch(
      `${url}/auth/v1/settings`,
      {
        headers: { apikey: key },

        // One small request per visit to a page
        // nobody loads in a loop, in exchange for
        // never being wrong about it.
        cache: "no-store",
      }
    );

    if (!response.ok) {
      return { providers: ALL };
    }

    const settings = await response.json();

    const external = (settings?.external ??
      {}) as Record<string, boolean>;

    return {
      providers: ALL.filter(
        (name) => external[name]
      ),
    };
  } catch {
    // Unreachable is not the same as switched
    // off. Offer them rather than hiding one
    // that genuinely works.

    return { providers: ALL };
  }
}


export default async function LoginPage() {
  const { providers } = await waysIn();

  // The line at the foot of this page promised
  // that the model runs on your own hardware.
  // That was true when Ollama was the only
  // option. With a hosted key configured it is a
  // choice, and the page has to say the true
  // version of whichever this workspace is.

  // A server key here means everyone using this
  // workspace gets a hosted model whether they
  // asked for one or not, so the claim has to
  // soften. A key somebody adds to their own
  // settings is their choice and does not change
  // what this page promises the workspace.

  const hostedAvailable =
    anthropicKey() !== null ||
    openaiKey() !== null;

  // A signed-out stranger should not see buttons
  // that cannot work. Whoever is building this
  // very much should: without it there is no way
  // to tell "not written yet" from "written, not
  // switched on", which is exactly the wrong
  // thing to be guessing about.
  //
  // So in development the rest are still drawn,
  // greyed out, saying where to turn them on. In
  // production they are simply absent.

  const dormant =
    process.env.NODE_ENV === "development"
      ? ALL.filter(
          (name) => !providers.includes(name)
        )
      : [];

  // Google's own button needs the web client ID
  // that Supabase's Google provider trusts. It is
  // public by design - it goes to every browser -
  // and read at request time, so changing it needs
  // a restart, not a rebuild.

  const googleClientId = providers.includes("google")
    ? process.env.GOOGLE_SIGNIN_CLIENT_ID ||
      process.env.GOOGLE_CLIENT_ID ||
      null
    : null;

  return (
    <LoginForm
      providers={providers}
      dormant={dormant}
      hostedAvailable={hostedAvailable}
      googleClientId={googleClientId}
    />
  );
}
