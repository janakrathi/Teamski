import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";


// ==========================================
// SECRETS AT REST
// ==========================================
//
// API keys, OAuth tokens and MCP sign-ins are
// sealed before they reach the database and
// opened only on the server when they are used.
// A copy of the database - a leaked backup, a
// mistaken policy, a stolen service key - then
// holds ciphertext, and the key that opens it
// lives only in the server's environment.
//
// AES-256-GCM: authenticated, so a value that was
// tampered with fails to open rather than opening
// to something else.
//
//   TEAMSKI_SECRET_KEY   32 random bytes, base64.
//                        Make one with:
//                        openssl rand -base64 32
//
// Lose the key and every stored secret is gone:
// people have to reconnect and re-enter keys.
// Back it up somewhere other than the server.
//
// Values written before this existed are plain
// text, and still open - they pass straight
// through - so nothing breaks while
// scripts/seal-secrets.mts converts them.
//

const PREFIX = "enc:v1:";

const IV_BYTES = 12;
const TAG_BYTES = 16;

let warned = false;


function keyBytes(): Buffer | null {
  const raw = process.env.TEAMSKI_SECRET_KEY?.trim();

  if (!raw) {
    return null;
  }

  const key = Buffer.from(raw, "base64");

  if (key.length !== 32) {
    throw new Error(
      "TEAMSKI_SECRET_KEY must be 32 bytes, base64 encoded. Make one with: openssl rand -base64 32"
    );
  }

  return key;
}


export function secretsConfigured() {
  return keyBytes() !== null;
}


export function isSealed(value: unknown) {
  return (
    typeof value === "string" && value.startsWith(PREFIX)
  );
}


// ------------------------------------------
// STRINGS
// ------------------------------------------

export function sealSecret(
  plain: string | null | undefined
): string | null {
  if (plain === null || plain === undefined) {
    return null;
  }

  if (isSealed(plain)) {
    return plain;
  }

  const key = keyBytes();

  if (!key) {
    // A live site storing keys in the clear is the
    // thing this file exists to prevent, so there
    // it refuses. On a laptop it warns and carries
    // on, so development does not need the key.

    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "TEAMSKI_SECRET_KEY is not set, so secrets cannot be stored. Add it to .env.local."
      );
    }

    if (!warned) {
      warned = true;

      console.warn(
        "TEAMSKI_SECRET_KEY is not set: secrets are being stored unencrypted. Fine locally, never in production."
      );
    }

    return plain;
  }

  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const body = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);

  return (
    PREFIX +
    Buffer.concat([iv, cipher.getAuthTag(), body]).toString(
      "base64"
    )
  );
}


export function openSecret(
  stored: string | null | undefined
): string | null {
  if (stored === null || stored === undefined) {
    return null;
  }

  // Written before encryption existed.

  if (!isSealed(stored)) {
    return stored;
  }

  const key = keyBytes();

  if (!key) {
    throw new Error(
      "A stored secret is encrypted but TEAMSKI_SECRET_KEY is not set on this server."
    );
  }

  const packed = Buffer.from(
    stored.slice(PREFIX.length),
    "base64"
  );

  if (packed.length < IV_BYTES + TAG_BYTES) {
    throw new Error("A stored secret is damaged.");
  }

  const iv = packed.subarray(0, IV_BYTES);
  const tag = packed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const body = packed.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);

  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([
      decipher.update(body),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong key, or the value was altered.

    throw new Error(
      "A stored secret could not be decrypted. The server's TEAMSKI_SECRET_KEY may have changed."
    );
  }
}


// ------------------------------------------
// BLIND INDEX
// ------------------------------------------
//
// A unique index cannot dedupe an encrypted column:
// every seal uses a fresh IV, so the same value stored
// twice becomes two different ciphertexts. This gives a
// value a stable fingerprint to put a unique index on
// instead - identical inputs always map to the same
// fingerprint, so duplicates still collide.
//
// Keyed with the server's own key (HMAC), so the
// fingerprint gives nothing away in a leaked database:
// short, guessable text (a remembered fact) would fall
// to a dictionary attack against a bare hash, but not
// against one whose key never left the server. Without
// a key (local dev, values kept in the clear anyway) a
// plain hash keeps dedupe working within that one
// machine.
//

export function blindIndex(plain: string): string {
  const normalised = plain.trim();

  const key = keyBytes();

  return key
    ? createHmac("sha256", key)
        .update(normalised)
        .digest("hex")
    : createHash("sha256")
        .update(normalised)
        .digest("hex");
}


// ------------------------------------------
// JSON COLUMNS
// ------------------------------------------
//
// An OAuth sign-in is an object, kept in a jsonb
// column. Sealed, it becomes { "sealed": "enc:…" }
// so the column stays valid JSON.
//

export function sealJson<T>(
  value: T | null | undefined
): { sealed: string } | null {
  if (value === null || value === undefined) {
    return null;
  }

  const sealed = sealSecret(JSON.stringify(value));

  // Without a key in development the object is
  // stored as it is, like the strings above.

  return sealed && isSealed(sealed)
    ? { sealed }
    : (value as unknown as { sealed: string });
}


export function openJson<T>(stored: unknown): T | null {
  if (stored === null || stored === undefined) {
    return null;
  }

  if (
    typeof stored === "object" &&
    isSealed((stored as { sealed?: unknown }).sealed)
  ) {
    const plain = openSecret(
      (stored as { sealed: string }).sealed
    );

    return plain ? (JSON.parse(plain) as T) : null;
  }

  return stored as T;
}
