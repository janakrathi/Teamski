// ==========================================
// SEND A TEST ALERT
// ==========================================
//
//   npm run alert:test
//
// Emails ALERT_EMAILS (or ADMIN_EMAILS) through
// Resend, the same way a real problem would, so
// you can see one arrive before you need to.
//

import { raiseAlert } from "../lib/alerts.ts";

const to = process.env.ALERT_EMAILS || process.env.ADMIN_EMAILS;

if (!to) {
  console.log("Set ADMIN_EMAILS (or ALERT_EMAILS) in .env.local first.");
  process.exit(1);
}

if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
  console.log("Set RESEND_API_KEY and EMAIL_FROM in .env.local first.");
  process.exit(1);
}

await raiseAlert("web", {
  key: "test",
  title: "Test alert from Teamski",
  detail:
    "If this reached your inbox, alerts work. Real ones look like this, with what went wrong in place of this text.",
});

console.log(`Sent a test alert to ${to}. Check the inbox, and spam.`);
