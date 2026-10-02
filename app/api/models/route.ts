import { createClient } from "@/lib/supabase/server";

import { modelsFor } from "@/lib/ai/providers";

import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";


// ==========================================
// WHAT THIS MACHINE CAN REACH
// ==========================================
//
// A hosted model with no key behind it is not a
// model this workspace has - offering it and
// failing on click is the pattern the login page
// already taught us not to repeat.
//
// Keys are read here and never returned. The
// answer is a list of names.
//

export async function GET(request: Request) {
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

  // Which project is open decides whether its
  // shared key is on offer.

  const projectId = new URL(
    request.url
  ).searchParams.get("projectId");

  return Response.json({
    providers: await modelsFor(
      db,
      user.id,
      projectId,
      adminClient()
    ),
  });
}
