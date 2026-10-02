import { test } from "node:test";

import assert from "node:assert/strict";

import { emailAlreadyUsed } from "../lib/auth/signup.ts";


test("Supabase's error for a taken address is recognised", () => {
  assert.equal(
    emailAlreadyUsed({ data: null, error: { message: "User already registered" } }),
    true
  );
});


test("the quiet answer - a user with no identities - is recognised too", () => {
  assert.equal(
    emailAlreadyUsed({ data: { user: { identities: [] } }, error: null }),
    true
  );
});


test("a genuinely new account is not mistaken for a taken one", () => {
  assert.equal(
    emailAlreadyUsed({
      data: { user: { identities: [{ provider: "email" }] } },
      error: null,
    }),
    false
  );

  // Supabase may leave identities out altogether.
  assert.equal(emailAlreadyUsed({ data: { user: {} }, error: null }), false);
});


test("other sign-up errors are left to the general message", () => {
  assert.equal(
    emailAlreadyUsed({
      data: null,
      error: { message: "Password should be at least 6 characters" },
    }),
    false
  );
});
