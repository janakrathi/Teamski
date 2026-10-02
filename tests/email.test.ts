import { test } from "node:test";

import assert from "node:assert/strict";

import {
  escapeHtml,
  projectInviteEmail,
  tidy,
} from "../lib/email/templates.ts";

import { sendEmail } from "../lib/email/send.ts";


const base = {
  to: "sam@example.org",
  inviterEmail: "riya@company.org",
  site: "https://teamski.in",
};


test("names cannot put HTML into the email", () => {
  const email = projectInviteEmail({
    ...base,
    inviterName: '<a href="x">Riya</a>',
    projectName: "<img src=x onerror=alert(1)>",
    hasAccount: false,
  });

  assert.doesNotMatch(email.html, /<img/);
  assert.doesNotMatch(email.html, /<a href="x">/);
  assert.match(email.html, /&lt;img/);
});


test("links are taken out of names", () => {
  assert.equal(
    tidy("Account locked, visit http://evil.example/login now"),
    "Account locked, visit [link] now"
  );

  assert.equal(tidy("go to www.evil.com"), "go to [link]");
  assert.equal(tidy("pay at secure-payments.com today"), "pay at [link] today");

  // Ordinary names survive.
  assert.equal(tidy("Website redesign"), "Website redesign");
  assert.equal(tidy("Q4 plan v2.1"), "Q4 plan v2.1");
});


test("an inviter with no display name is shown by their real email", () => {
  const email = projectInviteEmail({
    ...base,
    inviterName: null,
    projectName: "Launch",
    hasAccount: false,
  });

  assert.match(email.subject, /^riya@company\.org invited you to Launch/);
  assert.equal(email.replyTo, "riya@company.org");
});


test("the button goes to sign-up or to the app, and nothing personal is in it", () => {
  const invite = projectInviteEmail({
    ...base,
    inviterName: "Riya",
    projectName: "Launch",
    hasAccount: false,
  });

  const added = projectInviteEmail({
    ...base,
    inviterName: "Riya",
    projectName: "Launch",
    hasAccount: true,
  });

  assert.match(invite.text, /https:\/\/teamski\.in\/login\?mode=signup/);
  assert.match(added.text, /Open Teamski: https:\/\/teamski\.in\/$/m);
  assert.doesNotMatch(invite.html, /href="[^"]*sam@example/);
});


test("very long names are cut for the subject line", () => {
  const email = projectInviteEmail({
    ...base,
    inviterName: "R".repeat(300),
    projectName: "P".repeat(300),
    hasAccount: true,
  });

  assert.ok(email.subject.length < 200);
});


test("without a key nothing is sent and nothing throws", async () => {
  const saved = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;

  const result = await sendEmail({
    to: "x@example.org",
    subject: "s",
    html: "h",
    text: "t",
  });

  assert.deepEqual(result, { sent: false, reason: "not-configured" });

  if (saved) {
    process.env.RESEND_API_KEY = saved;
  }
});


test("escapeHtml covers quotes too", () => {
  assert.equal(escapeHtml(`"'<>&`), "&quot;&#39;&lt;&gt;&amp;");
});
