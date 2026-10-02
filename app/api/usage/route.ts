import { createClient } from "@/lib/supabase/server";
import { getUsage } from "@/lib/ai/usage";

export const dynamic = "force-dynamic";

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


// ==========================================
// USAGE SUMMARY
// ==========================================
//
// What this project has spent on the model over
// the last month.
//

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const projectId =
    searchParams.get("projectId") || "";

  if (!uuidRegex.test(projectId)) {
    return Response.json(
      { error: "A valid projectId is required." },
      { status: 400 }
    );
  }

  const channelId =
    searchParams.get("channelId") || "";

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

  const usage = await getUsage(db, {
    projectId,
    channelId: uuidRegex.test(channelId)
      ? channelId
      : null,
  });

  return Response.json(usage);
}
