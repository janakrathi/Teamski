// ==========================================
// WEB SEARCH
// ==========================================
//
// DuckDuckGo needs no key. Its HTML page first, its
// lite page if that comes back empty or refuses -
// the same two sources, and the same parsing, as the
// Teamski server (lib/ai/search.ts).
//

export type SearchResult = { title: string; url: string; snippet: string };

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

function htmlToText(html: string) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function looksBlocked(html: string) {
  return /anomaly-modal|challenge-form|captcha|unusual traffic|If this error persists/i.test(html);
}

function unwrap(url: string) {
  const wrapped = /uddg=([^&]+)/.exec(url);
  let clean = wrapped ? decodeURIComponent(wrapped[1]) : url;
  if (clean.startsWith("//")) clean = `https:${clean}`;
  return clean.replace(/&amp;/g, "&");
}

export function parseDuckDuckGoHtml(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const anchor = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let match: RegExpExecArray | null;

  while ((match = anchor.exec(html)) !== null) {
    const url = unwrap(match[1]);
    const title = htmlToText(match[2]);
    const after = html.slice(anchor.lastIndex, anchor.lastIndex + 2000);
    const snippet = htmlToText(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(after)?.[1] ?? "");
    if (title && url.startsWith("http")) results.push({ title, url, snippet });
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
    const snippet = htmlToText(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/.exec(after)?.[1] ?? "");
    if (title && url.startsWith("http")) results.push({ title, url, snippet });
  }

  return results;
}

async function post(url: string, query: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ q: query }).toString(),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
  });

  return response.text();
}

export async function webSearch(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  let blocked = false;

  try {
    const html = await post("https://html.duckduckgo.com/html/", query, signal);
    const results = parseDuckDuckGoHtml(html);
    if (results.length) return results;
    blocked = looksBlocked(html);
  } catch (error) {
    if (signal?.aborted) throw error;
  }

  const lite = await post("https://lite.duckduckgo.com/lite/", query, signal);
  const results = parseDuckDuckGoLite(lite);

  if (!results.length && (blocked || looksBlocked(lite))) {
    throw new Error("The search engine asked to prove this isn't a bot. Try again in a minute, or use fetch_url on a page you know.");
  }

  return results;
}
