import { htmlToText } from "./web.ts";


// ==========================================
// WEB SEARCH
// ==========================================
//
// Searching has to keep working for a team doing SEO
// all day, so it is a chain rather than one source.
// The free ones go first and the paid ones are only
// spent when those fail:
//
//   1. DuckDuckGo - no key, its HTML page
//   2. DuckDuckGo - no key, its lite page
//   3. Serper     - real Google results (SERPER_API_KEY)
//   4. Brave      - its own index (BRAVE_API_KEY)
//   5. Tavily     - built for AI agents (TAVILY_API_KEY)
//
// The paid ones are only tried when they have a key.
// A source that fails is
// rested for a while (longer when it says we are
// sending too much) so every search does not pay for
// waiting on it again. The same search in the next
// half hour comes from memory, which saves the paid
// quotas and answers instantly.
//
// What comes back is the same shape whichever source
// answered, so the agent never needs to know.
//

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export type SearchOptions = {
  // Two-letter country code for local results, e.g.
  // "in" for India. Optional.
  region?: string;
};

type Provider = {
  id: string;
  enabled: () => boolean;
  run: (query: string, options: SearchOptions) => Promise<SearchResult[]>;
};

const TIMEOUT_MS = 9000;

// DuckDuckGo's pages answer in about a second when they
// work; when the server is being blocked they can hang.
// A short wait keeps a blocked search from holding up the
// reply before the next source gets its turn.
const SCRAPED_TIMEOUT_MS = 3500;

const MAX_RESULTS = 8;

const USER_AGENT =
  "Mozilla/5.0 (compatible; Teamski/1.0; +https://teamski.in)";


// A source refused us outright (a block page, a
// captcha, 401/403/429), as opposed to an ordinary
// failure. It is rested for longer.

class Refused extends Error {}


async function get(url: string, init: RequestInit = {}, timeout = TIMEOUT_MS) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeout),
  });

  if (
    response.status === 401 ||
    response.status === 403 ||
    response.status === 429
  ) {
    throw new Refused(`answered ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(`answered ${response.status}`);
  }

  return response;
}


// ------------------------------------------
// THE SOURCES
// ------------------------------------------

const serper: Provider = {
  id: "serper",
  enabled: () => Boolean(process.env.SERPER_API_KEY),
  async run(query, { region }) {
    const response = await get("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": process.env.SERPER_API_KEY ?? "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: query,
        num: 10,
        ...(region ? { gl: region } : {}),
      }),
    });

    const data = (await response.json()) as {
      organic?: { title?: string; link?: string; snippet?: string }[];
    };

    return (data.organic ?? []).map((result) => ({
      title: result.title ?? "",
      url: result.link ?? "",
      snippet: result.snippet ?? "",
    }));
  },
};


const brave: Provider = {
  id: "brave",
  enabled: () => Boolean(process.env.BRAVE_API_KEY),
  async run(query, { region }) {
    const params = new URLSearchParams({ q: query, count: "10" });

    if (region) {
      params.set("country", region.toUpperCase());
    }

    const response = await get(
      `https://api.search.brave.com/res/v1/web/search?${params}`,
      {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": process.env.BRAVE_API_KEY ?? "",
        },
      }
    );

    const data = (await response.json()) as {
      web?: { results?: { title?: string; url?: string; description?: string }[] };
    };

    return (data.web?.results ?? []).map((result) => ({
      title: htmlToText(result.title ?? ""),
      url: result.url ?? "",
      snippet: htmlToText(result.description ?? ""),
    }));
  },
};


const tavily: Provider = {
  id: "tavily",
  enabled: () => Boolean(process.env.TAVILY_API_KEY),
  async run(query, { region }) {
    const response = await get("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.TAVILY_API_KEY ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        max_results: 10,
        search_depth: "basic",
        ...(region && countryName(region) ? { country: countryName(region) } : {}),
      }),
    });

    const data = (await response.json()) as {
      results?: { title?: string; url?: string; content?: string }[];
    };

    return (data.results ?? []).map((result) => ({
      title: result.title ?? "",
      url: result.url ?? "",
      snippet: (result.content ?? "").slice(0, 300),
    }));
  },
};


const duckduckgo: Provider = {
  id: "duckduckgo",
  enabled: () => true,
  async run(query, { region }) {
    const body = new URLSearchParams({ q: query });

    if (region) {
      body.set("kl", `${region.toLowerCase()}-en`);
    }

    const response = await get("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    }, SCRAPED_TIMEOUT_MS);

    return parseDuckDuckGoHtml(await response.text());
  },
};


const duckduckgoLite: Provider = {
  id: "duckduckgo-lite",
  enabled: () => true,
  async run(query, { region }) {
    const body = new URLSearchParams({ q: query });

    if (region) {
      body.set("kl", `${region.toLowerCase()}-en`);
    }

    const response = await get("https://lite.duckduckgo.com/lite/", {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    }, SCRAPED_TIMEOUT_MS);

    return parseDuckDuckGoLite(await response.text());
  },
};


// In order of preference: free first. Tests swap the
// list.

const DEFAULT_ORDER: Provider[] = [duckduckgo, duckduckgoLite, serper, brave, tavily];

let PROVIDERS: Provider[] = DEFAULT_ORDER;


// ------------------------------------------
// READING DUCKDUCKGO'S PAGES
// ------------------------------------------
//
// Exported so they can be tested against saved
// pages. When DuckDuckGo decides a server is a bot
// it answers 200 with a challenge instead of
// results, so an empty page that looks like one is
// treated as a refusal, not as "nothing found".
//

function looksBlocked(html: string) {
  return /anomaly-modal|challenge-form|captcha|unusual traffic|If this error persists/i.test(
    html
  );
}

function unwrap(url: string) {
  const wrapped = /uddg=([^&]+)/.exec(url);

  let clean = wrapped ? decodeURIComponent(wrapped[1]) : url;

  if (clean.startsWith("//")) {
    clean = `https:${clean}`;
  }

  return clean.replace(/&amp;/g, "&");
}

export function parseDuckDuckGoHtml(html: string): SearchResult[] {
  const results: SearchResult[] = [];

  // Walk the result anchors rather than splitting on
  // a class name: the markup carries several classes
  // per element, so an exact split misses results.

  const anchor = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;

  let match: RegExpExecArray | null;

  while ((match = anchor.exec(html)) !== null) {
    const url = unwrap(match[1]);

    const title = htmlToText(match[2]);

    // The snippet follows its own anchor.
    const after = html.slice(anchor.lastIndex, anchor.lastIndex + 2000);

    const snippet = htmlToText(
      /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(after)?.[1] ?? ""
    );

    if (title && url.startsWith("http")) {
      results.push({ title, url, snippet });
    }
  }

  if (results.length === 0 && looksBlocked(html)) {
    throw new Refused("asked to prove it is not a bot");
  }

  return results;
}

export function parseDuckDuckGoLite(html: string): SearchResult[] {
  const results: SearchResult[] = [];

  const anchor = /<a[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/g;

  let match: RegExpExecArray | null;

  while ((match = anchor.exec(html)) !== null) {
    const href = /href=['"]([^'"]+)['"]/.exec(match[0])?.[1] ?? "";

    const url = unwrap(href);

    const title = htmlToText(match[1]);

    const after = html.slice(anchor.lastIndex, anchor.lastIndex + 1500);

    const snippet = htmlToText(
      /class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/.exec(after)?.[1] ?? ""
    );

    if (title && url.startsWith("http")) {
      results.push({ title, url, snippet });
    }
  }

  if (results.length === 0 && looksBlocked(html)) {
    throw new Refused("asked to prove it is not a bot");
  }

  return results;
}


// ------------------------------------------
// RESTING A FAILING SOURCE
// ------------------------------------------

const resting = new Map<string, { until: number; strikes: number }>();

function isResting(id: string, now: number) {
  return (resting.get(id)?.until ?? 0) > now;
}

function rest(id: string, refused: boolean, now: number) {
  const strikes = (resting.get(id)?.strikes ?? 0) + 1;

  // 1, 2, 4... minutes for ordinary failures, from 10
  // for a refusal; never more than half an hour.
  const minutes = Math.min(30, (refused ? 10 : 1) * 2 ** (strikes - 1));

  resting.set(id, { until: now + minutes * 60_000, strikes });
}

function recovered(id: string) {
  resting.delete(id);
}


// ------------------------------------------
// REMEMBERING RECENT SEARCHES
// ------------------------------------------

const CACHE_MS = 30 * 60_000;

const CACHE_SIZE = 300;

const cache = new Map<string, { at: number; results: SearchResult[]; source: string }>();

function cacheKey(query: string, options: SearchOptions) {
  return `${query.trim().toLowerCase().replace(/\s+/g, " ")}|${(options.region ?? "").toLowerCase()}`;
}


// Same page, said slightly differently (tracking
// parameters, a trailing slash, www.), counts once.

function sameUrl(url: string) {
  try {
    const parsed = new URL(url);

    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|ref$|fbclid|gclid)/.test(key)) {
        parsed.searchParams.delete(key);
      }
    }

    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname.replace(/\/$/, "")}${parsed.search}`;
  } catch {
    return url;
  }
}

export function tidyResults(results: SearchResult[]) {
  const seen = new Set<string>();

  return results
    .filter((result) => result.title && /^https?:\/\//.test(result.url))
    .filter((result) => {
      const key = sameUrl(result.url);

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);

      return true;
    })
    .slice(0, MAX_RESULTS);
}


// ------------------------------------------
// SEARCH
// ------------------------------------------

export async function search(
  query: string,
  options: SearchOptions = {}
): Promise<
  | { ok: true; results: SearchResult[]; source: string }
  | { ok: false; error: string }
> {
  const q = query.trim();

  if (!q) {
    return { ok: false, error: "There was nothing to search for." };
  }

  const region = /^[a-z]{2}$/i.test(options.region ?? "")
    ? options.region!.toLowerCase()
    : undefined;

  const key = cacheKey(q, { region });

  const now = Date.now();

  const remembered = cache.get(key);

  if (remembered && now - remembered.at < CACHE_MS) {
    return { ok: true, results: remembered.results, source: remembered.source };
  }

  const failures: string[] = [];

  const available = PROVIDERS.filter((provider) => provider.enabled());

  // If every source is resting, try them anyway
  // rather than refuse outright.
  const awake = available.filter((provider) => !isResting(provider.id, now));

  const skipped = new Set<string>();

  for (const provider of awake.length ? awake : available) {
    if (skipped.has(provider.id)) {
      continue;
    }

    const started = Date.now();

    try {
      const results = tidyResults(await provider.run(q, { region }));

      recovered(provider.id);

      console.log(
        `[search] ${provider.id} ${results.length} results in ${Date.now() - started}ms`
      );

      // An empty answer is a real answer from a paid
      // source; from a scraped page it is more often a
      // quiet failure, so the next source gets a turn.
      if (results.length === 0 && provider.id.startsWith("duckduckgo")) {
        failures.push(`${provider.id}: nothing found`);

        continue;
      }

      if (results.length > 0) {
        if (cache.size >= CACHE_SIZE) {
          cache.delete(cache.keys().next().value!);
        }

        cache.set(key, { at: Date.now(), results, source: provider.id });
      }

      return { ok: true, results, source: provider.id };
    } catch (cause) {
      const refused = cause instanceof Refused;

      rest(provider.id, refused, Date.now());

      const reason = cause instanceof Error ? cause.message : "failed";

      failures.push(`${provider.id}: ${reason}`);

      console.error(`[search] ${provider.id} failed (${reason}); trying the next source`);

      // DuckDuckGo refusing the server - a block page, a
      // captcha, or no answer in time - means its other
      // page is blocked too. Skip it and rest it, so the
      // reply isn't held up waiting on it as well.
      if (provider.id.startsWith("duckduckgo") && (refused || /timeout|aborted/i.test(reason))) {
        for (const other of available) {
          if (other.id !== provider.id && other.id.startsWith("duckduckgo")) {
            rest(other.id, refused, Date.now());
            skipped.add(other.id);
          }
        }
      }
    }
  }

  // Every source either failed or found nothing.
  if (failures.every((failure) => failure.endsWith("nothing found"))) {
    return { ok: true, results: [], source: "none" };
  }

  return {
    ok: false,
    error: "Web search is not available right now. Try again in a minute.",
  };
}


// ------------------------------------------
// FOR TESTS
// ------------------------------------------

export const __sources = { serper, brave, tavily, duckduckgo, duckduckgoLite };

export function __setProviders(list: Provider[]) {
  PROVIDERS = list;

  resting.clear();

  cache.clear();
}

export function __reset() {
  PROVIDERS = DEFAULT_ORDER;

  resting.clear();

  cache.clear();
}


function countryName(code: string) {
  const names: Record<string, string> = {
    in: "india", us: "united states", gb: "united kingdom", ae: "united arab emirates",
    sg: "singapore", au: "australia", ca: "canada", de: "germany", fr: "france",
  };

  return names[code.toLowerCase()];
}
