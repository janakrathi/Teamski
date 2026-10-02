// ==========================================
// SEND YOURSELF THE COMING-BACK EMAIL
// ==========================================
//
//   npm run winback-test -- you@example.com
//
// Sends one copy of the win-back email to the address
// you pass (or ADMIN_EMAILS if you pass none), through
// Resend, exactly as a real nudge looks. It does NOT
// touch anyone's winback_sent_at and does NOT go near
// the real candidate list - it is only for seeing the
// email in your own inbox.
//

import { sendEmail } from "../lib/email/send.ts";

import { winbackEmail } from "../lib/email/templates.ts";


// ------------------------------------------
// LOAD .env.local
// ------------------------------------------
//
// A plain node script gets none of Next's env loading,
// so read the file itself - the same best-effort way
// the worker does.

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

const to =
  process.argv[2]?.trim() || process.env.ADMIN_EMAILS;

if (!to) {
  console.log(
    "Who to? Pass an address:\n  npm run winback-test -- you@example.com"
  );
  process.exit(1);
}

if (
  !process.env.RESEND_API_KEY ||
  !process.env.EMAIL_FROM
) {
  console.log(
    "Set RESEND_API_KEY and EMAIL_FROM in .env.local first."
  );
  process.exit(1);
}

const site =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://teamski.in";

const result = await sendEmail(
  winbackEmail({ to, site, name: null })
);

if (result.sent) {
  console.log(
    `Sent the coming-back email to ${to}. Check the inbox, and spam.`
  );
} else {
  console.log(
    `Not sent (${result.reason})${
      result.detail ? `: ${result.detail}` : ""
    }`
  );
}
