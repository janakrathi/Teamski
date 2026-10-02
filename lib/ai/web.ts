// ==========================================
// WEB ACCESS
// ==========================================
//
// Searching and reading pages, with two things
// kept firmly in mind:
//
//   1. A fetched page is untrusted input. It can
//      contain text addressed to the model. It is
//      returned fenced and labelled, never as
//      instructions.
//
//   2. A URL chosen by a model can point at the
//      machine this runs on. Anything private is
//      refused before a request is made.
//

import { lookup } from "node:dns/promises";

import { isIP } from "node:net";

export const MAX_PAGE_CHARS = 6000;

const FETCH_TIMEOUT_MS = 15000;

const MAX_BYTES = 2 * 1024 * 1024;

const USER_AGENT =
  "Teamski/1.0 (+https://teamski.in)";


// ------------------------------------------
// SSRF GUARD
// ------------------------------------------
//
// The model picks these URLs, so treat them the
// way the file tools treat filenames.
//

const BLOCKED_HOSTS = [
  "localhost",
  "metadata.google.internal",
  "metadata",
];

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase();

  if (BLOCKED_HOSTS.includes(host)) {
    return true;
  }

  // Anything that is not a public name: bare
  // hostnames, .local, .internal.

  if (
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost")
  ) {
    return true;
  }

  const bare = host.replace(/^\[|\]$/g, "");

  if (isIP(bare)) {
    return isPrivateAddress(bare);
  }

  return false;
}


// An address, rather than a name: loopback, link
// local, the private and shared ranges, and
// anything reserved. IPv4 written inside IPv6
// (::ffff:127.0.0.1, which URL turns into
// [::ffff:7f00:1]) is checked as the IPv4 it is.

export function isPrivateAddress(address: string) {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, "");

  if (isIP(ip) === 6) {
    const mapped = /^::ffff:(.+)$/.exec(ip)?.[1];

    if (mapped) {
      if (isIP(mapped) === 4) {
        return isPrivateAddress(mapped);
      }

      const [high, low] = mapped
        .split(":")
        .map((part) => parseInt(part, 16));

      return isPrivateAddress(
        [high >> 8, high & 255, low >> 8, low & 255].join(".")
      );
    }

    // Loopback and unspecified.

    if (ip === "::1" || ip === "::") {
      return true;
    }

    // Unique local, fc00::/7, and link local,
    // fe80::/10 - the range the metadata services
    // live on.

    return /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip);
  }

  if (isIP(ip) !== 4) {
    return false;
  }

  const [a, b] = ip.split(".").map(Number);

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}


export function checkUrl(raw: string): {
  url: URL | null;
  error?: string;
} {
  let url: URL;

  try {
    url = new URL(raw.trim());
  } catch {
    return {
      url: null,
      error: `"${raw}" is not a valid URL.`,
    };
  }

  if (
    url.protocol !== "http:" &&
    url.protocol !== "https:"
  ) {
    return {
      url: null,
      error: "Only http and https addresses can be opened.",
    };
  }

  if (isPrivateHost(url.hostname)) {
    return {
      url: null,
      error:
        "That address is on a private network, so it will not be opened.",
    };
  }

  return { url };
}


// A public-looking name can still point at a
// private address (127.0.0.1.nip.io, or a domain
// someone set up for it), so look the name up
// and check every address it gives.

export async function checkUrlResolved(raw: string): Promise<{
  url: URL | null;
  error?: string;
}> {
  const checked = checkUrl(raw);

  if (!checked.url) {
    return checked;
  }

  const host = checked.url.hostname.replace(/^\[|\]$/g, "");

  if (isIP(host)) {
    return checked;
  }

  try {
    const addresses = await lookup(host, { all: true });

    if (addresses.some((entry) => isPrivateAddress(entry.address))) {
      return {
        url: null,
        error:
          "That address is on a private network, so it will not be opened.",
      };
    }
  } catch {
    return {
      url: null,
      error: `${host} could not be found.`,
    };
  }

  return checked;
}


// ------------------------------------------
// HTML TO TEXT
// ------------------------------------------
//
// Enough to read an article. Not a browser.
//

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
  mdash: "-",
  ndash: "-",
  hellip: "...",
};

export function htmlToText(html: string) {
  return html
    // Everything that is not prose.
    .replace(
      /<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi,
      " "
    )
    .replace(/<!--[\s\S]*?-->/g, " ")

    // Keep the shape of the document.
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")

    .replace(/<[^>]+>/g, " ")

    .replace(
      /&(#?\w+);/g,
      (whole, name: string) =>
        ENTITIES[name.toLowerCase()] ?? whole
    )

    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}


function clamp(text: string) {
  if (text.length <= MAX_PAGE_CHARS) {
    return { text, truncated: false };
  }

  return {
    text: text.slice(0, MAX_PAGE_CHARS),
    truncated: true,
  };
}


// ------------------------------------------
// FETCH A PAGE
// ------------------------------------------

const MAX_REDIRECTS = 5;

export async function fetchPage(raw: string) {
  const { url, error } = await checkUrlResolved(raw);

  if (!url) {
    return { ok: false as const, error: error! };
  }

  try {
    // Redirects are followed by hand, so every
    // address is checked before a request goes to
    // it - not after, when the request has already
    // reached whatever was there.

    const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);

    let current = url;

    let response: Response;

    for (let hop = 0; ; hop++) {
      response = await fetch(current, {
        redirect: "manual",

        headers: {
          "User-Agent": USER_AGENT,
          Accept:
            "text/html,application/xhtml+xml,text/plain;q=0.9",
        },

        signal,
      });

      const location = response.headers.get("location");

      if (
        response.status < 300 ||
        response.status >= 400 ||
        !location
      ) {
        break;
      }

      if (hop >= MAX_REDIRECTS) {
        return {
          ok: false as const,
          error: `${url.hostname} redirected too many times.`,
        };
      }

      const next = await checkUrlResolved(
        new URL(location, current).toString()
      );

      if (!next.url) {
        return { ok: false as const, error: next.error! };
      }

      current = next.url;
    }

    if (!response.ok) {
      return {
        ok: false as const,
        error: `${url.hostname} returned ${response.status}.`,
      };
    }

    const type =
      response.headers.get("content-type") ?? "";

    if (
      !type.includes("html") &&
      !type.includes("text") &&
      !type.includes("json")
    ) {
      return {
        ok: false as const,
        error: `${url.hostname} returned ${
          type || "an unreadable type"
        }, which cannot be read as text.`,
      };
    }

    const body = await response.text();

    if (body.length > MAX_BYTES) {
      return {
        ok: false as const,
        error: "That page is too large to read.",
      };
    }

    const title =
      /<title[^>]*>([\s\S]*?)<\/title>/i
        .exec(body)?.[1]
        ?.trim() ?? url.hostname;

    const { text, truncated } = clamp(
      type.includes("html")
        ? htmlToText(body)
        : body.trim()
    );

    if (!text) {
      return {
        ok: false as const,
        error: `${url.hostname} had no readable text.`,
      };
    }

    return {
      ok: true as const,
      url: response.url,
      title,
      text,
      truncated,
    };
  } catch (cause) {
    const message =
      cause instanceof Error &&
      cause.name === "TimeoutError"
        ? "took too long to respond"
        : "could not be reached";

    return {
      ok: false as const,
      error: `${url.hostname} ${message}.`,
    };
  }
}


// ------------------------------------------
// SEARCH
// ------------------------------------------
//
// DuckDuckGo's HTML endpoint needs no key, which
// keeps this working out of the box. Set
// BRAVE_API_KEY to use Brave instead, which is
// steadier and returns cleaner results.
//

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

async function searchBrave(
  query: string,
  key: string
): Promise<SearchResult[]> {
  const response = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(
      query
    )}&count=6`,
    {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": key,
      },
      signal: AbortSignal.timeout(
        FETCH_TIMEOUT_MS
      ),
    }
  );

  if (!response.ok) {
    throw new Error(
      `Brave returned ${response.status}.`
    );
  }

  const data = (await response.json()) as {
    web?: {
      results?: {
        title?: string;
        url?: string;
        description?: string;
      }[];
    };
  };

  return (data.web?.results ?? []).map(
    (result) => ({
      title: result.title ?? "",
      url: result.url ?? "",
      snippet: htmlToText(
        result.description ?? ""
      ),
    })
  );
}


async function searchDuckDuckGo(
  query: string
): Promise<SearchResult[]> {
  const response = await fetch(
    "https://html.duckduckgo.com/html/",
    {
      method: "POST",

      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type":
          "application/x-www-form-urlencoded",
      },

      body: `q=${encodeURIComponent(query)}`,

      signal: AbortSignal.timeout(
        FETCH_TIMEOUT_MS
      ),
    }
  );

  if (!response.ok) {
    throw new Error(
      `Search returned ${response.status}.`
    );
  }

  const html = await response.text();

  const results: SearchResult[] = [];

  // Walk the result anchors rather than splitting
  // on a class name: the markup carries several
  // classes per element, so an exact split misses
  // every result.

  const anchor =
    /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;

  let match: RegExpExecArray | null;

  while ((match = anchor.exec(html)) !== null) {
    if (results.length >= 8) {
      break;
    }

    let url = match[1];

    // Some results are wrapped in a redirect.

    const wrapped = /uddg=([^&]+)/.exec(url);

    if (wrapped) {
      url = decodeURIComponent(wrapped[1]);
    }

    if (url.startsWith("//")) {
      url = `https:${url}`;
    }

    const title = htmlToText(match[2]);

    // The snippet follows its own anchor.

    const after = html.slice(
      anchor.lastIndex,
      anchor.lastIndex + 2000
    );

    const snippet = htmlToText(
      /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(
        after
      )?.[1] ?? ""
    );

    if (title && url.startsWith("http")) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}


export async function search(query: string) {
  const key = process.env.BRAVE_API_KEY;

  try {
    const results = key
      ? await searchBrave(query, key)
      : await searchDuckDuckGo(query);

    return {
      ok: true as const,
      results: results.slice(0, 6),
    };
  } catch (cause) {
    return {
      ok: false as const,
      error:
        cause instanceof Error
          ? cause.message
          : "The search failed.",
    };
  }
}
