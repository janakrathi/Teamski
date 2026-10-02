import { test } from "node:test";

import assert from "node:assert/strict";

import { randomBytes } from "node:crypto";

import {
  blindIndex,
  isSealed,
  openJson,
  openSecret,
  sealJson,
  sealSecret,
} from "../lib/crypto/secrets.ts";


function withKey<T>(key: string | undefined, run: () => T): T {
  const saved = process.env.TEAMSKI_SECRET_KEY;

  if (key === undefined) {
    delete process.env.TEAMSKI_SECRET_KEY;
  } else {
    process.env.TEAMSKI_SECRET_KEY = key;
  }

  try {
    return run();
  } finally {
    if (saved === undefined) {
      delete process.env.TEAMSKI_SECRET_KEY;
    } else {
      process.env.TEAMSKI_SECRET_KEY = saved;
    }
  }
}

const KEY = randomBytes(32).toString("base64");


test("a sealed secret opens to what went in, and does not show it", () => {
  withKey(KEY, () => {
    const sealed = sealSecret("sk-ant-api-very-secret");

    assert.ok(isSealed(sealed));
    assert.doesNotMatch(sealed!, /very-secret/);
    assert.equal(openSecret(sealed), "sk-ant-api-very-secret");

    // Fresh randomness each time, so equal keys do
    // not look equal in the database.
    assert.notEqual(sealSecret("same"), sealSecret("same"));
  });
});


test("values stored before encryption still open", () => {
  withKey(KEY, () => {
    assert.equal(openSecret("ghp_plain_old_token"), "ghp_plain_old_token");
    assert.equal(openSecret(null), null);
  });
});


test("a tampered value refuses to open", () => {
  withKey(KEY, () => {
    const sealed = sealSecret("token")!;

    const bytes = Buffer.from(sealed.slice("enc:v1:".length), "base64");
    bytes[bytes.length - 1] ^= 1;

    assert.throws(() =>
      openSecret("enc:v1:" + bytes.toString("base64"))
    );
  });
});


test("the wrong key refuses to open", () => {
  const sealed = withKey(KEY, () => sealSecret("token"));

  withKey(randomBytes(32).toString("base64"), () => {
    assert.throws(() => openSecret(sealed), /could not be decrypted/);
  });

  withKey(undefined, () => {
    assert.throws(() => openSecret(sealed), /not set/);
  });
});


test("sealing twice does not wrap twice", () => {
  withKey(KEY, () => {
    const once = sealSecret("x");

    assert.equal(sealSecret(once), once);
  });
});


test("a blind index dedupes what encryption scatters", () => {
  withKey(KEY, () => {
    // The same fact always fingerprints the same, so a
    // unique index still catches a duplicate...
    assert.equal(
      blindIndex("the user prefers dark mode"),
      blindIndex("the user prefers dark mode")
    );

    // ...even though sealing it twice does not.
    assert.notEqual(
      sealSecret("the user prefers dark mode"),
      sealSecret("the user prefers dark mode")
    );

    // Whitespace around the value is not part of it.
    assert.equal(
      blindIndex("  a fact  "),
      blindIndex("a fact")
    );

    // Different values do not collide, and the
    // fingerprint does not carry the value.
    assert.notEqual(blindIndex("alice"), blindIndex("bob"));
    assert.doesNotMatch(blindIndex("alice"), /alice/);
  });
});


test("the blind index is keyed: the key changes it", () => {
  const withServerKey = withKey(KEY, () =>
    blindIndex("secret fact")
  );

  const withOtherKey = withKey(
    randomBytes(32).toString("base64"),
    () => blindIndex("secret fact")
  );

  // Same input, different server key, different
  // fingerprint - so a leaked table cannot be matched
  // against a guessed dictionary without the key.
  assert.notEqual(withServerKey, withOtherKey);
});


test("JSON columns round trip and stay valid JSON", () => {
  withKey(KEY, () => {
    const tokens = { access_token: "a", refresh_token: "r", expires_in: 3600 };

    const sealed = sealJson(tokens);

    assert.ok(isSealed(sealed?.sealed));
    assert.doesNotMatch(JSON.stringify(sealed), /refresh_token/);
    assert.deepEqual(openJson(sealed), tokens);

    // An object saved before encryption passes through.
    assert.deepEqual(openJson(tokens), tokens);
  });
});


test("a key of the wrong length is rejected", () => {
  withKey(Buffer.from("short").toString("base64"), () => {
    assert.throws(() => sealSecret("x"), /32 bytes/);
  });
});


test("in production, no key means nothing is stored", () => {
  const env = process.env as Record<string, string | undefined>;
  const saved = env.NODE_ENV;
  env.NODE_ENV = "production";

  try {
    withKey(undefined, () => {
      assert.throws(() => sealSecret("x"), /not set/);
    });
  } finally {
    env.NODE_ENV = saved;
  }
});
