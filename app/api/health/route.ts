import { getOllamaStatus } from "@/lib/ai/ollama";

export const dynamic = "force-dynamic";


// ==========================================
// MODEL HEALTH
// ==========================================
//
// The UI polls this to show whether the
// self-hosted model is up, and which model
// it is talking to.
//

export async function GET() {
  const status = await getOllamaStatus();

  return Response.json(status, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
