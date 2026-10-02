import { createClient } from "@/lib/supabase/server";

import { sealSecret } from "@/lib/crypto/secrets";

import { verifyImageKey } from "@/lib/ai/providers/images";

export const dynamic = "force-dynamic";


// ==========================================
// YOUR OWN IMAGE KEY (CLOUDFLARE)
// ==========================================
//
// Image generation runs on a shared Cloudflare
// account by default. A person can connect their own
// - an account id and a Workers AI token - for their
// own daily limit. Stored per person, encrypted, and
// used by the generate_image tool in place of the
// shared one.
//
// Kept apart from model keys (provider "image:...",
// not "model:...") so it never shows up in the model
// picker.
//

const PROVIDER = "image:cloudflare";


export async function GET() {
  const db = await createClient();

  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    return Response.json(
      { error: "You must be logged in." },
      { status: 401 }
    );
  }

  const { data } = await db
    .from("connections")
    .select("provider")
    .eq("user_id", user.id)
    .eq("provider", PROVIDER)
    .maybeSingle();

  return Response.json({ connected: Boolean(data) });
}


export async function POST(request: Request) {
  const db = await createClient();

  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    return Response.json(
      { error: "You must be logged in." },
      { status: 401 }
    );
  }

  const body = (await request
    .json()
    .catch(() => ({}))) as {
    accountId?: string;
    token?: string;
  };

  const accountId = (body.accountId ?? "").trim();
  const token = (body.token ?? "").trim();

  if (!accountId || !token) {
    return Response.json(
      {
        error:
          "Both the account ID and the token are needed.",
      },
      { status: 400 }
    );
  }

  // Checked before it is stored, so a bad one fails
  // here rather than in the middle of a picture.
  const wrong = await verifyImageKey(accountId, token);

  if (wrong) {
    return Response.json(
      { error: wrong },
      { status: 400 }
    );
  }

  const { error } = await db
    .from("connections")
    .upsert(
      {
        user_id: user.id,
        provider: PROVIDER,
        account_email: "Cloudflare Workers AI",
        access_token: sealSecret(token),
        refresh_token: null,
        expires_at: null,
        scopes: [],
        config: { account_id: accountId },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" }
    );

  if (error) {
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return Response.json({ ok: true });
}


export async function DELETE() {
  const db = await createClient();

  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    return Response.json(
      { error: "You must be logged in." },
      { status: 401 }
    );
  }

  const { error } = await db
    .from("connections")
    .delete()
    .eq("user_id", user.id)
    .eq("provider", PROVIDER);

  if (error) {
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return Response.json({ ok: true });
}
