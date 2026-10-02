import type { ModelInfo } from "./types.ts";


// ==========================================
// GROQ, AS A SHARED BUILT-IN
// ==========================================
//
// Groq runs open models very fast, and its free
// tier is generous enough to hand the whole Free
// plan a genuinely capable model without anyone
// pasting a key. One key lives in the server's
// environment (GROQ_API_KEY); every Free user
// draws on it, rationed by the same daily message
// allowance as the local machine.
//
// The wire protocol is OpenAI's, so the streaming
// itself goes through openaiProvider with the
// base URL pointed at Groq (see index.ts). This
// file only holds the key and the model list.
//
// Groq is also offered as a bring-your-own-key
// preset (compatible.ts) for anyone who wants
// their own quota; that path is separate from
// this shared one.
//

export function groqKey() {
  return process.env.GROQ_API_KEY || null;
}

export const GROQ_BASE_URL =
  "https://api.groq.com/openai/v1";


// The model a new chat answers with when the
// server has a shared Groq key and the person has
// not chosen one themselves. Qualified the way the
// router expects ("groq/" + the maker's id).

export const GROQ_DEFAULT_MODEL =
  "groq/openai/gpt-oss-120b";


// The free-tier model that can see images. A turn
// with an image attached is routed here, since the
// text models above cannot read one. Qwen 3 27B
// takes up to 3 images, each ~2048 tokens.

export const GROQ_VISION_MODEL =
  "groq/qwen/qwen3.8-27b";


// The model id is exactly what Groq's API expects
// (it keeps the maker's namespace, e.g.
// "openai/gpt-oss-120b"). Qualified for the app it
// becomes "groq/openai/gpt-oss-120b"; unqualify
// splits on the first slash, so the maker's slash
// survives.
//
// Free tier, per key: 30 req/min, 1K req/day, 8K
// tokens/min, 200K tokens/day. The per-minute
// token cap is the tight one - roughly one full
// context request a minute - so keep contexts
// modest and let the daily allowance spread users
// out.

export const GROQ_MODELS: ModelInfo[] = [
  {
    id: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B (fast, free)",
    contextWindow: 131_072,
    costPerMTokIn: 0,
    costPerMTokOut: 0,
  },
  {
    id: "openai/gpt-oss-20b",
    label: "GPT-OSS 20B (fastest, free)",
    contextWindow: 131_072,
    costPerMTokIn: 0,
    costPerMTokOut: 0,
  },
  {
    id: "qwen/qwen3.8-27b",
    label: "Qwen3 27B (reads images, free)",
    contextWindow: 131_072,
    costPerMTokIn: 0,
    costPerMTokOut: 0,
  },
];
