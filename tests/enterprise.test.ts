import { test } from "node:test";

import assert from "node:assert/strict";

import { cleanLead, sheetSafe } from "../lib/enterprise.ts";

import { enterpriseLeadEmail } from "../lib/email/templates.ts";


const GOOD = {
  name: "Asha Rao",
  email: "Asha@Example.com",
  company: "Acme",
  role: "CTO",
  teamSize: "51–200",
  phone: "",
  country: "India",
  needs: "We want a shared agent for our engineering channels.",
};


test("a complete enquiry is accepted and tidied", () => {
  const result = cleanLead({ ...GOOD, name: "  Asha   Rao " });

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.equal(result.lead.name, "Asha Rao");
    assert.equal(result.lead.email, "asha@example.com");
  }
});


test("missing or malformed fields are refused with a reason", () => {
  for (const broken of [
    { ...GOOD, name: "" },
    { ...GOOD, email: "not-an-email" },
    { ...GOOD, company: " " },
    { ...GOOD, teamSize: "a million" },
    { ...GOOD, needs: "hi" },
  ]) {
    const result = cleanLead(broken);

    assert.equal(result.ok, false);
  }
});


test("anything that is not the promised shape is treated as empty", () => {
  assert.equal(cleanLead(null).ok, false);
  assert.equal(cleanLead({ ...GOOD, name: { evil: true } }).ok, false);
});


test("long answers are cut to size", () => {
  const result = cleanLead({ ...GOOD, needs: "x".repeat(10_000) });

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.equal(result.lead.needs.length, 3000);
  }
});


test("a value that would be a spreadsheet formula is stored as text", () => {
  assert.equal(sheetSafe('=HYPERLINK("http://evil")'), `'=HYPERLINK("http://evil")`);
  assert.equal(sheetSafe("+91 98765 43210"), "'+91 98765 43210");
  assert.equal(sheetSafe("@acme"), "'@acme");
  assert.equal(sheetSafe("Acme Inc"), "Acme Inc");
});


test("the notification email escapes what the stranger typed", () => {
  const email = enterpriseLeadEmail({
    to: "team@teamski.in",
    site: "https://teamski.in",
    lead: { ...GOOD, needs: '<script>alert(1)</script>\n<a href="x">click</a>' },
  });

  assert.ok(!email.html.includes("<script>"));
  assert.ok(!email.html.includes('<a href="x">'));
  assert.equal(email.replyTo, GOOD.email);
});
