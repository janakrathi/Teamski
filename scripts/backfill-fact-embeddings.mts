// ==========================================
// BACKFILL FACT EMBEDDINGS
// ==========================================
//
//   npm run memory:backfill
//
// Semantic memory only searches facts that have a
// vector. New facts get one when they are written;
// facts saved before that (or while the embedder
// was down) do not, and surface only by recency.
//
// This walks every fact with no vector, embeds it
// with the same local model the app uses, and saves
// the result - so the whole memory becomes
// searchable by meaning, not just the recent part.
//
// Run it on the server (where Ollama and .env.local
// are). Safe to run more than once: it only touches
// facts that are still missing a vector, and a fact
// it cannot embed is left for the next run rather
// than failing the whole job.
//

import { createClient } from "@supabase/supabase-js";

import { EMBED_MODEL, embed } from "../lib/ai/ollama.ts";

import { openSecret } from "../lib/crypto/secrets.ts";


const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.log(
    "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first."
  );
  process.exit(1);
}

// The service role bypasses row-level security, so
// this one script can see and fix facts across every
// project. It must only ever run on the server.

const db = createClient(url, key, {
  auth: { persistSession: false },
});


// Collect every fact still missing a vector, before
// touching any - so updating rows does not shift the
// pages under us.

const pending: { id: string; content: string }[] = [];

const PAGE = 500;

for (let from = 0; ; from += PAGE) {
  const { data, error } = await db
    .from("memory_facts")
    .select("id, content")
    .is("embedding", null)
    .order("created_at", { ascending: true })
    .range(from, from + PAGE - 1);

  if (error) {
    console.log("Could not read facts:", error.message);
    process.exit(1);
  }

  if (!data || data.length === 0) {
    break;
  }

  pending.push(...(data as { id: string; content: string }[]));

  if (data.length < PAGE) {
    break;
  }
}

if (pending.length === 0) {
  console.log("Every fact already has a vector. Nothing to do.");
  process.exit(0);
}

console.log(
  `Embedding ${pending.length} fact(s) with ${EMBED_MODEL}...`
);


let embedded = 0;
let skipped = 0;

for (const [index, fact] of pending.entries()) {
  // Facts are sealed at rest; embed the plaintext.
  // openSecret returns older, unsealed facts untouched.
  const vector = await embed(
    openSecret(fact.content) ?? fact.content
  );

  if (!vector) {
    skipped++;

    // A run of failures at the very start usually
    // means the model is not pulled - say so once and
    // stop rather than churning through the whole set.
    if (skipped === 10 && embedded === 0) {
      console.log(
        `\nThe embedder returned nothing for the first 10 facts.\n` +
          `Pull the model first:  ollama pull ${EMBED_MODEL}\n` +
          `Then run this again.`
      );
      process.exit(1);
    }

    continue;
  }

  const { error } = await db
    .from("memory_facts")
    .update({ embedding: vector })
    .eq("id", fact.id);

  if (error) {
    skipped++;
    console.log(`  skip ${fact.id}: ${error.message}`);
    continue;
  }

  embedded++;

  // A quiet heartbeat, so a long run shows progress.
  if ((index + 1) % 50 === 0) {
    console.log(`  ${index + 1} / ${pending.length}`);
  }
}

console.log(
  `\nDone. Embedded ${embedded}, skipped ${skipped}.` +
    (skipped > 0
      ? " Skipped facts keep their place and are retried next run."
      : "")
);

process.exit(0);
