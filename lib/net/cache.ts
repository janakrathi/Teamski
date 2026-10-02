"use client";

// ==========================================
// A SMALL CLIENT-SIDE GET CACHE
// ==========================================
//
// Several panels used to fetch the same rarely-changing
// data from the server every time they opened, and block
// on a "Loading…" line each time - one round-trip per
// open, each revalidating the session against Supabase.
//
// This keeps the parsed JSON of a GET keyed by its URL,
// so the second open reads it instantly. The data here
// only changes through the user's own actions in the
// same UI (adding a key, disconnecting an app), and
// every such action forces a re-read, so the cache never
// drifts. An OAuth round-trip reloads the whole page,
// which starts the cache fresh anyway.
//
// Same shape as lib/account/profile.ts, generalised to
// any URL.
//

type Entry = {
  value?: unknown;
  has: boolean;
  inflight?: Promise<unknown>;
};

const store = new Map<string, Entry>();


function entryFor(url: string): Entry {
  let entry = store.get(url);

  if (!entry) {
    entry = { has: false };
    store.set(url, entry);
  }

  return entry;
}


// The JSON for a GET, fetched once and reused. `force`
// re-reads it (after a mutation). A failed fetch is not
// cached, so the next caller retries rather than
// inheriting the error.

export function cachedJson<T = unknown>(
  url: string,
  options?: { force?: boolean }
): Promise<T> {
  const entry = entryFor(url);

  if (entry.has && !options?.force) {
    return Promise.resolve(entry.value as T);
  }

  if (!entry.inflight || options?.force) {
    entry.inflight = fetch(url, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();

        // Only a good response is cached. An error body
        // is handed back for the caller to show, but not
        // remembered, so the next read tries again.
        if (response.ok) {
          entry.value = data;
          entry.has = true;
        }

        entry.inflight = undefined;
        return data;
      })
      .catch((error) => {
        entry.inflight = undefined;
        throw error;
      });
  }

  return entry.inflight as Promise<T>;
}


// What is already known for a URL, synchronously - so a
// panel can show it with no flash of loading.

export function peekJson<T = unknown>(
  url: string
): T | undefined {
  const entry = store.get(url);

  return entry?.has ? (entry.value as T) : undefined;
}


// Fire-and-forget warm-up, so the data is waiting before
// the panel that needs it is opened.

export function primeJson(url: string) {
  void cachedJson(url).catch(() => {});
}


// Forget a URL (or every URL beginning with a prefix),
// so the next read fetches fresh. Called after a
// mutation that changed what the server would return.

export function invalidateJson(prefix: string) {
  for (const key of [...store.keys()]) {
    if (key === prefix || key.startsWith(prefix)) {
      store.delete(key);
    }
  }
}


// Replace what is cached for a URL, after a mutation
// whose response already carries the new state.

export function setJson(url: string, value: unknown) {
  store.set(url, { value, has: true });
}
