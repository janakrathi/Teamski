"use client";

// ==========================================
// A CLIENT-SIDE CACHE FOR YOUR PROFILE
// ==========================================
//
// The account settings panel used to fetch
// /api/profile every time it opened and block on it -
// a visible "Loading your account…" each time, and each
// wait is a round-trip that revalidates the session
// against Supabase. The data barely changes, so this
// fetches it once and keeps it: opening settings a
// second time is instant, and priming it when the app
// loads makes even the first open instant.
//

export type ProfileData = {
  id: string;
  email: string;
  display_name: string | null;
  username: string | null;
  avatar_url?: string | null;
};

export type ProfileResult = {
  profile: ProfileData | null;
  needsMigration?: boolean;
};


let settled: ProfileResult | null = null;
let inflight: Promise<ProfileResult> | null = null;


// The profile, fetched once and reused. `force` re-reads
// it (after a save, or when the account may have
// changed). A failed fetch is not cached, so the next
// caller tries again rather than inheriting the error.

export function loadProfile(
  force = false
): Promise<ProfileResult> {
  if (settled && !force) {
    return Promise.resolve(settled);
  }

  if (!inflight || force) {
    inflight = fetch("/api/profile", {
      cache: "no-store",
    })
      .then((response) => response.json())
      .then((data: ProfileResult) => {
        settled = data;
        inflight = null;
        return data;
      })
      .catch((error) => {
        inflight = null;
        throw error;
      });
  }

  return inflight;
}


// What is already known, synchronously - so a panel that
// opens after the prime shows the account with no flash
// of loading at all.

export function peekProfile(): ProfileResult | null {
  return settled;
}


// Fire-and-forget warm-up, called once when the app
// loads so the first settings open has the data waiting.

export function primeProfile() {
  void loadProfile().catch(() => {});
}


// Keep the cache in step after a successful save.

export function updateProfile(profile: ProfileData) {
  settled = { profile };
}


// After sign-out the next person to use this browser
// must not see the last one's account.

export function clearProfileCache() {
  settled = null;
  inflight = null;
}
