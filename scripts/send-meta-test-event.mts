// ==========================================
// CHECK THE META CONVERSIONS API
// ==========================================
//
//   npm run meta:test -- TEST12345
//
// Sends one PageView from this server straight to Meta,
// tagged with the test code from Events Manager -> Test
// events -> "Confirm your server's events". It shows up
// there within seconds, whatever the browser blocks, and
// never counts toward real ad results.
//
// Pass the code, or set META_TEST_EVENT_CODE.
//

import { randomUUID } from "node:crypto";

import { metaConfig, sendMetaEvents } from "../lib/analytics/capi.ts";


// A plain node script gets none of Next's env loading.

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
    // Already in the environment is fine.
  }
}


await loadDotEnv();

const config = metaConfig();

if (!config) {
  console.log(
    "Set META_CAPI_TOKEN in .env.local first (Events Manager -> Settings -> Conversions API -> Generate access token)."
  );
  process.exit(1);
}

const testCode = process.argv[2]?.trim() || config.testCode;

if (!testCode) {
  console.log(
    "Pass the test code from Events Manager -> Test events:\n  npm run meta:test -- TEST12345"
  );
  process.exit(1);
}

const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://teamski.in";

const result = await sendMetaEvents(
  [
    {
      name: "PageView",
      id: `capi-check-${randomUUID()}`,
      url: `${site}/`,
      user: {
        externalId: "teamski-capi-check",
        userAgent: "Teamski Conversions API check",
      },
    },
  ],
  { testCode }
);

if (result.sent) {
  console.log(
    `Meta received ${result.received} event for pixel ${config.pixelId}. Look in Events Manager -> Test events: a server PageView should be there now.`
  );
} else {
  console.log(
    `Not sent (${result.reason})${result.detail ? `: ${result.detail}` : ""}`
  );
  process.exit(1);
}
