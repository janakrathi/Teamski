import { cookies } from "next/headers";


// ==========================================
// PROVING THE ROUND TRIP WAS OURS
// ==========================================
//
// An OAuth connect flow leaves the site and
// comes back with a code in the URL. Without
// something tying the return to the departure,
// anyone can send a signed-in person a link that
// lands on the callback carrying *their* code -
// and the victim silently connects the
// attacker's account. Everything the agent then
// reads or writes goes to a stranger's
// spreadsheet.
//
// So: a random value, kept in an httpOnly
// cookie, echoed through the provider in the
// state parameter, and checked on the way back.
// A code that arrives without its matching
// cookie did not start here.
//

const COOKIE = "oauth_state";

// Long enough to survive a slow consent screen,
// short enough that a stale one is not lying
// around.

const MAX_AGE_SECONDS = 600;


export async function issueState(
  provider: string
) {
  const value = `${provider}.${crypto.randomUUID()}`;

  const jar = await cookies();

  jar.set(COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,

    // Plain http on localhost has to keep
    // working; anywhere else this rides https.
    secure: process.env.NODE_ENV === "production",
  });

  return value;
}


// True only when the returned state matches the
// cookie this browser was given. Single use:
// the cookie is cleared either way, so a replay
// of the same URL fails.

export async function consumeState(
  provider: string,
  returned: string | null
) {
  const jar = await cookies();

  const expected = jar.get(COOKIE)?.value ?? null;

  jar.delete(COOKIE);

  if (!expected || !returned) {
    return false;
  }

  if (!expected.startsWith(`${provider}.`)) {
    return false;
  }

  // Lengths are equal and both are ours, so a
  // plain comparison is fine here; there is no
  // secret to leak a byte at a time.

  return expected === returned;
}
