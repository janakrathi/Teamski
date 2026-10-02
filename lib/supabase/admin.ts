import "server-only";

import { createClient } from "@supabase/supabase-js";


// ==========================================
// THE KEY NOBODY MAY READ
// ==========================================
//
// A project's model key is usable by everyone in
// the project and readable by none of them. That
// is not a contradiction, it is the point: a
// policy that let members select the row would
// let any of them pull the key out of the
// database from a browser and keep it.
//
// So row level security refuses the read, and the
// server does it with the service role - which
// bypasses RLS entirely and must therefore never
// reach the browser. The import above is what
// makes that a build error rather than a
// discovery.
//
// Use this for one thing: fetching a credential
// the caller is allowed to spend but not to see.
// Everything else goes through the request-scoped
// client, so RLS keeps doing its job.
//

let cached: ReturnType<typeof createClient> | null =
  null;


export function adminClient() {
  if (cached) {
    return cached;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return null;
  }

  cached = createClient(url, key, {
    auth: { persistSession: false },
  });

  return cached;
}
