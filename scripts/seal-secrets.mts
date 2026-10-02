import { createClient } from "@supabase/supabase-js";

import {
  isSealed,
  sealJson,
  sealSecret,
  secretsConfigured,
} from "../lib/crypto/secrets.ts";


// ==========================================
// ENCRYPT WHAT WAS STORED BEFORE
// ==========================================
//
// Keys and tokens saved before encryption existed
// are plain text. This seals them in place.
//
//   npm run seal-secrets              count only
//   npm run seal-secrets -- --write   do it
//
// Safe to run more than once: anything already
// sealed is left alone. Needs TEAMSKI_SECRET_KEY
// and SUPABASE_SERVICE_ROLE_KEY in .env.local.
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

const db = createClient(url, serviceKey, {
  auth: { persistSession: false },
});


type Plan = {
  table: string;
  text: string[];
  json: string[];
};

const PLANS: Plan[] = [
  {
    table: "connections",
    text: ["access_token", "refresh_token"],
    json: [],
  },
  {
    table: "project_model_keys",
    text: ["access_token"],
    json: [],
  },
  {
    table: "mcp_servers",
    text: ["access_token", "code_verifier"],
    json: ["oauth_client", "oauth_tokens"],
  },
];


function plainJson(value: unknown) {
  return (
    value !== null &&
    typeof value === "object" &&
    !isSealed((value as { sealed?: unknown }).sealed)
  );
}


let total = 0;

for (const plan of PLANS) {
  const columns = ["id", ...plan.text, ...plan.json].join(", ");

  const { data, error } = await db
    .from(plan.table)
    .select(columns);

  if (error) {
    // A table from a migration not run yet has
    // nothing in it to seal.

    console.log(`${plan.table}: skipped (${error.message})`);

    continue;
  }

  let changed = 0;

  for (const row of (data ?? []) as unknown as Record<
    string,
    unknown
  >[]) {
    const patch: Record<string, unknown> = {};

    for (const column of plan.text) {
      const value = row[column];

      if (typeof value === "string" && !isSealed(value)) {
        patch[column] = sealSecret(value);
      }
    }

    for (const column of plan.json) {
      if (plainJson(row[column])) {
        patch[column] = sealJson(row[column]);
      }
    }

    if (Object.keys(patch).length === 0) {
      continue;
    }

    changed++;

    if (write) {
      const { error: updateError } = await db
        .from(plan.table)
        .update(patch)
        .eq("id", row.id as string);

      if (updateError) {
        console.error(
          `${plan.table} ${row.id}: ${updateError.message}`
        );
      }
    }
  }

  total += changed;

  console.log(
    `${plan.table}: ${changed} row(s) ${
      write ? "sealed" : "to seal"
    }`
  );
}

console.log(
  write
    ? `Done. ${total} row(s) sealed.`
    : `${total} row(s) would be sealed. Run with --write to do it.`
);
