import type { OllamaMessage, ToolSpec } from "../ollama.ts";


// ==========================================
// ROTATING WELL ACROSS SOMEONE'S KEYS
// ==========================================
//
// "Rotate my keys" spends free tiers before anything
// paid. Three things make that go further:
//
// 1. The right model for the message. Free tiers give a
//    lot of the small models and little of the strong
//    ones - Gemini's Flash-Lite allows ~500 requests a
//    day, its Flash ~20. A quick ask goes to the small
//    model, real work to the strong one, so the strong
//    quota is still there when it matters.
//
// 2. Not sending what can't fit. Groq's free tier caps
//    tokens per minute (8K) and refuses a bigger request
//    outright, so a long one skips Groq instead of
//    spending a request to hear "too large".
//
// 3. Resting a key for as long as the provider says.
//    A per-minute limit clears in seconds, a daily one
//    in hours; the error usually says which.
//

// Each service's models, small first then strong, by
// the ids Teamski suggests. A person's own saved list
// decides what is available; this only decides order.
const TIERS: Record<string, { cheap: string[]; strong: string[] }> = {
  groq: {
    cheap: ["openai/gpt-oss-20b"],
    strong: ["openai/gpt-oss-120b"],
  },
  google: {
    cheap: ["gemini-3.5-flash-lite"],
    strong: ["gemini-3.8-flash", "gemini-2.5-flash"],
  },
  mistral: {
    cheap: ["mistral-small-latest", "ministral-8b-latest", "ministral-3b-latest"],
    strong: ["mistral-large-latest", "mistral-medium-latest", "magistral-medium-latest"],
  },
  nvidia: {
    cheap: ["nvidia/nemotron-3.5-lightning-30b-a3b"],
    strong: ["nvidia/nemotron-3-super-120b-a12b", "nvidia/nemotron-3-ultra-550b-a55b"],
  },
};

// The model to ask on a service, from what is saved for
// it. Null when nothing is saved.
export function pickRotationModel(service: string, saved: string[], strong: boolean) {
  const usable = saved.filter((id) => !/(^|\/)auto$/.test(id));

  if (usable.length === 0) {
    return null;
  }

  const tiers = TIERS[service];

  if (!tiers) {
    return usable[0];
  }

  const wanted = strong ? [...tiers.strong, ...tiers.cheap] : [...tiers.cheap, ...tiers.strong];

  return wanted.find((id) => usable.includes(id)) ?? usable[0];
}


// About how many tokens a request is: a character count
// over four, which is close for English and errs high
// for code - the safe side for a limit.
export function requestTokens(messages: OllamaMessage[], tools?: ToolSpec[]) {
  const text = messages.reduce((sum, message) => sum + (message.content?.length ?? 0), 0);

  const schemas = tools ? JSON.stringify(tools).length : 0;

  const images = messages.reduce((sum, message) => sum + (message.images?.length ?? 0), 0);

  return Math.ceil((text + schemas) / 4) + images * 1500;
}


// The largest request each free tier takes at once,
// leaving room for the reply. Services not listed take
// anything a Teamski request will be.
const MAX_REQUEST: Record<string, number> = {
  groq: 6500,
};

export function fitsService(service: string, tokens: number) {
  return tokens <= (MAX_REQUEST[service] ?? Infinity);
}


// How long the provider asked us to wait, in ms, if it
// said. Read from a Retry-After header, or from the
// error text: "Please try again in 7m12.5s" (Groq),
// "Please retry in 34.2s" (Gemini), "retryDelay": "40s".
export function retryAfterMs(error: unknown): number | null {
  const headers = (error as { headers?: unknown } | null)?.headers;

  const header =
    headers && typeof (headers as Headers).get === "function"
      ? (headers as Headers).get("retry-after")
      : (headers as Record<string, string> | undefined)?.["retry-after"];

  if (header && /^\d+(\.\d+)?$/.test(header.trim())) {
    return Math.round(Number(header) * 1000);
  }

  const text = error instanceof Error ? error.message : typeof error === "string" ? error : "";

  const millis = /(?:try again|retry)\D{0,12}([\d.]+)ms/i.exec(text);

  if (millis) {
    return Math.round(Number(millis[1]));
  }

  const match =
    /(?:try again|retry|retryDelay)\D{0,12}((?:\d+h)?(?:\d+m(?!s))?(?:[\d.]+s)?)/i.exec(text);

  if (!match || !match[1]) {
    return null;
  }

  const part = (unit: string) => Number(new RegExp(`([\\d.]+)${unit}`).exec(match[1])?.[1] ?? 0);

  const ms = (part("h") * 3600 + part("m(?!s)") * 60 + part("s")) * 1000;

  return ms > 0 ? Math.round(ms) : null;
}
