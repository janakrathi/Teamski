import type { ModelInfo } from "./types.ts";


// ==========================================
// CEREBRAS - ANOTHER FAST, FREE SHARED KEY
// ==========================================
//
// Like Groq: very fast inference of strong open
// models, on a generous free tier - far larger daily
// limits than Groq (qwen-3.8-27b alone is hundreds of
// millions of tokens a day). One key in the server's
// environment (CEREBRAS_API_KEY) serves everyone, and
// it sits after Groq in the fallback chain so a spike
// that drains Groq keeps landing on a strong model
// rather than the local machine.
//
// OpenAI-compatible, so it streams through the same
// provider as Groq with the base URL pointed here.
//

export function cerebrasKey() {
  return process.env.CEREBRAS_API_KEY || null;
}

export const CEREBRAS_BASE_URL =
  "https://api.cerebras.ai/v1";

export const CEREBRAS_DEFAULT_MODEL =
  "cerebras/gpt-oss-120b";

// Cerebras's image-reading model, for a vision turn.
export const CEREBRAS_VISION_MODEL =
  "cerebras/qwen-3.8-27b";


// Model ids exactly as Cerebras names them (no
// maker namespace, unlike Groq). qwen-3.8-27b has the
// huge daily budget and reads images; gpt-oss-120b is
// the strongest but lower on requests-per-minute.

export const CEREBRAS_MODELS: ModelInfo[] = [
  {
    id: "gpt-oss-120b",
    label: "GPT-OSS 120B (Cerebras)",
    contextWindow: 131_000,
    costPerMTokIn: 0,
    costPerMTokOut: 0,
  },
  {
    id: "qwen-3.8-27b",
    label: "Qwen3 27B (Cerebras, reads images)",
    contextWindow: 131_072,
    costPerMTokIn: 0,
    costPerMTokOut: 0,
  },
];
