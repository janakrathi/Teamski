import type { ProviderId, ProviderKind } from "../shared/types.ts";

// ==========================================
// PROVIDERS
// ==========================================
//
// Every model the Code agent can use is on the
// person's own key, or on their own machine
// (Ollama). Teamski adds no keys of its own.
//
// Most providers speak OpenAI's chat completions
// API, so they differ only in address. The free
// ones come first: a free Groq or Gemini key is the
// fastest way to a capable coding model.
//

export type ProviderPreset = {
  id: ProviderId;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  needsKey: boolean;
  keyUrl?: string;
  note?: string;
  free?: boolean;
  editableUrl?: boolean;
  // Whether the API accepts stream_options.include_usage.
  streamUsage?: boolean;
  // Suggested when the model list cannot be fetched.
  suggested: string[];
  // A sensible first pick for coding.
  recommended?: string;
};

export const PROVIDERS: ProviderPreset[] = [
  {
    id: "groq",
    label: "Groq",
    kind: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    needsKey: true,
    keyUrl: "https://console.groq.com/keys",
    note: "Free key, very fast. GPT-OSS 120B is a solid coding model.",
    free: true,
    streamUsage: true,
    suggested: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"],
    recommended: "openai/gpt-oss-120b",
  },
  {
    id: "google",
    label: "Google Gemini",
    kind: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    needsKey: true,
    keyUrl: "https://aistudio.google.com/apikey",
    note: "Free key with daily limits. Huge context - good for big codebases.",
    free: true,
    suggested: ["gemini-3.8-flash", "gemini-3.8-pro"],
    recommended: "gemini-3.8-flash",
  },
  {
    id: "cerebras",
    label: "Cerebras",
    kind: "openai",
    baseUrl: "https://api.cerebras.ai/v1",
    needsKey: true,
    keyUrl: "https://cloud.cerebras.ai/",
    note: "Free key, extremely fast, large daily limits.",
    free: true,
    streamUsage: true,
    suggested: ["gpt-oss-120b", "qwen-3.8-27b"],
    recommended: "gpt-oss-120b",
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    needsKey: true,
    keyUrl: "https://console.anthropic.com/settings/keys",
    note: "Paid. The strongest coding models.",
    suggested: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
    recommended: "claude-sonnet-5-5",
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    needsKey: true,
    keyUrl: "https://platform.openai.com/api-keys",
    note: "Paid.",
    streamUsage: true,
    suggested: ["gpt-5", "gpt-5-mini"],
    recommended: "gpt-5",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    needsKey: true,
    keyUrl: "https://openrouter.ai/keys",
    note: "One key for hundreds of models, some free.",
    streamUsage: true,
    suggested: ["qwen/qwen3-coder", "anthropic/claude-sonnet-5-5"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    kind: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    needsKey: true,
    keyUrl: "https://platform.deepseek.com/api_keys",
    note: "Paid, very cheap.",
    streamUsage: true,
    suggested: ["deepseek-chat", "deepseek-reasoner"],
    recommended: "deepseek-chat",
  },
  {
    id: "mistral",
    label: "Mistral",
    kind: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    needsKey: true,
    keyUrl: "https://console.mistral.ai/api-keys",
    note: "Free experiment tier. Devstral is built for coding agents.",
    free: true,
    suggested: ["devstral-medium-latest", "devstral-small-latest"],
    recommended: "devstral-medium-latest",
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    kind: "openai",
    baseUrl: "https://api.x.ai/v1",
    needsKey: true,
    keyUrl: "https://console.x.ai/",
    note: "Paid.",
    streamUsage: true,
    suggested: ["grok-code-fast-1", "grok-4"],
    recommended: "grok-code-fast-1",
  },
  {
    id: "ollama",
    label: "Ollama (this computer)",
    kind: "ollama",
    baseUrl: "http://127.0.0.1:11434",
    needsKey: false,
    keyUrl: "https://ollama.com/download",
    note: "Free and private: models run on your own computer. Needs a good GPU for coding - try qwen3-coder.",
    free: true,
    editableUrl: true,
    suggested: ["qwen3-coder:30b", "qwen3:8b"],
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    kind: "openai",
    baseUrl: "",
    needsKey: false,
    note: "Any server that speaks OpenAI's API: LM Studio, vLLM, a company gateway.",
    editableUrl: true,
    suggested: [],
  },
];

export function presetFor(id: string): ProviderPreset | undefined {
  return PROVIDERS.find((preset) => preset.id === id);
}

// "groq::openai/gpt-oss-120b" -> { provider, model }.
// The model keeps any slashes of its own.
export function splitModel(value: string): { provider: ProviderId; model: string } | null {
  const at = value.indexOf("::");

  if (at === -1) {
    return null;
  }

  const provider = value.slice(0, at);
  const model = value.slice(at + 2);

  if (!presetFor(provider) || !model) {
    return null;
  }

  return { provider: provider as ProviderId, model };
}

export function joinModel(provider: ProviderId, model: string) {
  return `${provider}::${model}`;
}

// How much conversation to keep, in characters
// (~4 per token). A local model's window is set
// here too, so the two agree.
export const OLLAMA_CONTEXT_TOKENS = 32_768;

export function contextBudgetChars(provider: ProviderId) {
  if (provider === "ollama") {
    return OLLAMA_CONTEXT_TOKENS * 3;
  }

  // Groq's free tier caps tokens per minute rather
  // than the window; staying lean keeps each step
  // under it.
  if (provider === "groq" || provider === "cerebras") {
    return 60_000;
  }

  return 400_000;
}
