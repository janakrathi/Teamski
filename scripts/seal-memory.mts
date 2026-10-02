import { createClient } from "@supabase/supabase-js";

import {
  blindIndex,
  isSealed,
  sealSecret,
  secretsConfigured,
} from "../lib/crypto/secrets.ts";


// ==========================================
// ENCRYPT MEMORY STORED BEFORE SEALING
// ==========================================
//
// The agent's durable facts and rolling summaries used
// to be stored as plain text. Migration 0031 and the
// code around it seal them going forward; this seals
// the ones already there.
//
//   npm run seal-memory              count only
//   npm run seal-memory -- --write   do it
//
// For each fact it writes the sealed content AND its
// content_hash (the keyed fingerprint the unique index
// now dedupes on) together, computed from the plaintext
// before it is sealed. Summaries just get sealed.
//
// Run AFTER 0031 and AFTER deploying the sealing code.
// Safe to run more than once: anything already sealed
// is left alone. Needs TEAMSKI_SECRET_KEY and
// SUPABASE_SERVICE_ROLE_KEY in .env.local.
//

async function loadDotEnv() {
  const fs = await import("node:fs/promises");

  try {
    const raw = await fs.readFile(
      new URL("../.env.local", import.meta.url),
      "utf-8"
    );

    for (const line of raw.split("\n")) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const index = trimmed.indexOf("=");

      if (index === -1) {
        continue;
      }

      const name = trimmed.slice(0, index).trim();

      const value = trimmed
        .slice(index + 1)
        .trim()
        .replace(/^["']|["']$/g, "");

      if (!process.env[name]) {
        process.env[name] = value;
      }
    }
  } catch {
    // The environment may already be populated.
  }
}


await loadDotEnv();

const write = process.argv.includes("--write");

if (!secretsConfigured()) {
  console.error(
    "TEAMSKI_SECRET_KEY is not set. Add it to .env.local first (openssl rand -base64 32)."
  );

  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed."
  );

  process.exit(1);
}

// The service role bypasses row-level security, so this
// one script can seal memory across every project. It
// must only ever run on the server.

const db = createClient(url, serviceKey, {
  auth: { persistSession: false },
});


const PAGE = 500;


// ------------------------------------------
// FACTS
// ------------------------------------------

async function sealFacts() {
  const rows: { id: string; content: string }[] = [];

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("memory_facts")
      .select("id, content")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) {
      console.log(
        `memory_facts: skipped (${error.message})`
      );

      return;
    }

    if (!data || data.length === 0) {
      break;
    }

    rows.push(
      ...(data as { id: string; content: string }[])
    );

    if (data.length < PAGE) {
      break;
    }
  }

  let changed = 0;

  for (const row of rows) {
    if (
      typeof row.content !== "string" ||
      isSealed(row.content)
    ) {
      continue;
    }

    changed++;

    if (!write) {
      continue;
    }

    const patch = {
      content: sealSecret(row.content),
      content_hash: blindIndex(row.content),
    };

    const { error } = await db
      .from("memory_facts")
      .update(patch)
      .eq("id", row.id);

    if (error) {
      // A duplicate fingerprint means the same fact was
      // written again (already sealed) after the migration
      // and before this run: the sealed copy already holds
      // it, so drop this older plaintext row.
      if (error.code === "23505") {
        await db
          .from("memory_facts")
          .delete()
          .eq("id", row.id);

        continue;
      }

      console.error(
        `memory_facts ${row.id}: ${error.message}`
      );
    }
  }

  console.log(
    `memory_facts: ${changed} row(s) ${
      write ? "sealed" : "to seal"
    }`
  );

  return changed;
}


// ------------------------------------------
// SUMMARIES
// ------------------------------------------

async function sealSummaries() {
  const rows: { id: string; summary: string }[] = [];

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("conversation_summaries")
      .select("id, summary")
      .range(from, from + PAGE - 1);

    if (error) {
      console.log(
        `conversation_summaries: skipped (${error.message})`
      );

      return;
    }

    if (!data || data.length === 0) {
      break;
    }

    rows.push(
      ...(data as { id: string; summary: string }[])
    );

    if (data.length < PAGE) {
      break;
    }
  }

  let changed = 0;

  for (const row of rows) {
    if (
      typeof row.summary !== "string" ||
      isSealed(row.summary)
    ) {
      continue;
    }

    changed++;

    if (!write) {
      continue;
    }

    const { error } = await db
      .from("conversation_summaries")
      .update({ summary: sealSecret(row.summary) })
      .eq("id", row.id);

    if (error) {
      console.error(
        `conversation_summaries ${row.id}: ${error.message}`
      );
    }
  }

  console.log(
    `conversation_summaries: ${changed} row(s) ${
      write ? "sealed" : "to seal"
    }`
  );

  return changed;
}


const facts = (await sealFacts()) ?? 0;
const summaries = (await sealSummaries()) ?? 0;

const total = facts + summaries;

console.log(
  write
    ? `Done. ${total} row(s) sealed.`
    : `${total} row(s) would be sealed. Run with --write to do it.`
);

process.exit(0);
