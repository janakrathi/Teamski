// ==========================================
// EVERYTHING THAT SPEAKS OPENAI
// ==========================================
//
// Groq, DeepSeek, Mistral, OpenRouter, Together,
// Gemini through its compatibility endpoint, and
// any vLLM or LM Studio server a company runs
// themselves - all of them serve the OpenAI Chat
// Completions API at a different address.
//
// So they are not a dozen integrations. They are
// one integration and a list of base URLs.
//
// The last entry matters most for this product:
// a company that wants a bigger model than a
// desktop GPU can hold, without handing their
// conversations to anybody, points this at their
// own server.
//

export type Preset = {
  id: string;
  label: string;
  baseUrl: string;

  // Where to get a key, so nobody has to go
  // looking.
  keysUrl?: string;

  // Enough to start with. Every one of these
  // serves more; the field is editable.
  suggested: {
    id: string;
    label: string;

    contextWindow?: number;

    // Requests a day on the provider's free tier,
    // until the person enters their own - these
    // vary by account, so it is only a start.
    dailyLimit?: number;
  }[];

  // A server somebody runs themselves needs an
  // address and usually no key at all.
  selfHosted?: boolean;

  // One line shown under the key form: the thing
  // worth knowing before signing up.
  note?: string;
};


export const PRESETS: Preset[] = [
  {
    id: "google",
    label: "Google Gemini",
    baseUrl:
      "https://generativelanguage.googleapis.com/v1beta/openai",
    keysUrl: "https://aistudio.google.com/apikey",

    note: "Free keys from Google AI Studio work on every plan, including Free. They are rate limited, and on Google's free tier what you send may be used to improve Google's products.",

    // Fastest first: the first one is what a new
    // key is set to answer with.
    suggested: [
      {
        id: "gemini-3.5-flash-lite",
        label: "Gemini 3.5 Flash-Lite (fastest)",
        contextWindow: 1_048_576,
        dailyLimit: 500,
      },
      {
        id: "gemini-3.8-flash",
        label: "Gemini 3.8 Flash (smartest)",
        contextWindow: 1_048_576,
        dailyLimit: 20,
      },
      {
        id: "gemini-2.5-flash",
        label: "Gemini 2.5 Flash",
        contextWindow: 1_048_576,
        dailyLimit: 20,
      },
    ],
  },

  {
    id: "groq",

    // Groq, with a q: the inference host that
    // runs open models very fast. xAI's Grok is
    // a separate entry below.
    label: "Groq (fast open models)",
    baseUrl: "https://api.groq.com/openai/v1",
    keysUrl: "https://console.groq.com/keys",

    note: "Free keys from console.groq.com work on every plan, including Free. Bring your own for a faster model on your own daily limit.",

    // The same models the shared key serves, so
    // bringing your own key is a straight swap - your
    // GPT-OSS 120B on your own quota - not a different
    // set of models.
    suggested: [
      {
        id: "openai/gpt-oss-120b",
        label: "GPT-OSS 120B",
        contextWindow: 131_072,
      },
      {
        id: "openai/gpt-oss-20b",
        label: "GPT-OSS 20B (fastest)",
        contextWindow: 131_072,
      },
      {
        id: "qwen/qwen3.8-27b",
        label: "Qwen3 27B (reads images)",
        contextWindow: 131_072,
      },
    ],
  },

  {
    id: "cerebras",
    label: "Cerebras (fast open models)",
    baseUrl: "https://api.cerebras.ai/v1",
    keysUrl: "https://cloud.cerebras.ai/",

    note: "Free keys from cloud.cerebras.ai work on every plan, including Free. Very fast, with large daily limits.",

    suggested: [
      {
        id: "gpt-oss-120b",
        label: "GPT-OSS 120B",
        contextWindow: 131_000,
      },
      {
        id: "qwen-3.8-27b",
        label: "Qwen3 27B (reads images)",
        contextWindow: 131_072,
      },
    ],
  },

  {
    id: "nvidia",
    label: "NVIDIA (Nemotron)",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    keysUrl: "https://build.nvidia.com/settings/api-keys",

    // build.nvidia.com hands out free keys, but
    // its terms keep them to trying models out:
    // serving real users on one needs a paid
    // NVIDIA AI Enterprise licence. Said here,
    // so nobody finds out from NVIDIA.
    note: "Free keys from build.nvidia.com are for trying models out, about 40 requests a minute. NVIDIA's terms need a paid licence for production use.",

    suggested: [
      {
        id: "nvidia/nemotron-3-super-120b-a12b",
        label: "Nemotron 3 Super",
      },
      {
        id: "nvidia/nemotron-3.5-lightning-30b-a3b",
        label: "Nemotron 3.5 Lightning",
      },
      {
        id: "nvidia/nemotron-3-ultra-550b-a55b",
        label: "Nemotron 3 Ultra",
      },
    ],
  },

  {
    id: "xai",
    label: "xAI Grok",
    baseUrl: "https://api.x.ai/v1",
    keysUrl: "https://console.x.ai",

    // Not Groq, which is above and is a different
    // company entirely - an inference host, not a
    // model maker. The two get mistaken for each
    // other constantly, which is why both labels
    // spell out whose they are.
    suggested: [
      { id: "grok-4.3", label: "Grok 4.3" },
      {
        id: "grok-4.1-fast",
        label: "Grok 4.1 Fast",
      },
    ],
  },

  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    keysUrl:
      "https://platform.deepseek.com/api_keys",

    suggested: [
      {
        id: "deepseek-chat",
        label: "DeepSeek Chat",
      },
      {
        id: "deepseek-reasoner",
        label: "DeepSeek Reasoner",
      },
    ],
  },

  {
    id: "mistral",
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    keysUrl: "https://console.mistral.ai/api-keys",

    suggested: [
      {
        id: "mistral-large-latest",
        label: "Mistral Large",
      },
      {
        id: "mistral-small-latest",
        label: "Mistral Small",
      },
    ],
  },

  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keysUrl: "https://openrouter.ai/keys",

    // One key, most of the field. Worth knowing
    // about before setting up five separate
    // accounts.
    note: "One key for hundreds of models, including Nemotron. Models ending in :free cost nothing but are rate limited, and some free providers may log prompts.",

    suggested: [
      // OpenRouter's own router: it picks a model per
      // request, billed at that model's price with no
      // extra fee.
      {
        id: "openrouter/auto",
        label: "Auto (OpenRouter picks)",
      },
      {
        id: "nvidia/nemotron-3.5-lightning",
        label: "Nemotron 3.5 Lightning",
      },
      {
        id: "anthropic/claude-sonnet-4.5",
        label: "Claude Sonnet 4.5",
      },
      {
        id: "google/gemini-2.5-pro",
        label: "Gemini 2.5 Pro",
      },
      {
        id: "meta-llama/llama-3.3-70b-instruct",
        label: "Llama 3.3 70B",
      },
    ],
  },

  {
    id: "together",
    label: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    keysUrl: "https://api.together.ai/settings/api-keys",

    suggested: [
      {
        id: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        label: "Llama 3.3 70B Turbo",
      },
      {
        id: "Qwen/Qwen2.5-72B-Instruct-Turbo",
        label: "Qwen 2.5 72B",
      },
    ],
  },

  {
    id: "custom",
    label: "Your own server",
    baseUrl: "",
    selfHosted: true,

    // vLLM, LM Studio, llama.cpp, text-generation
    // -inference: all of them serve this API.
    suggested: [],
  },
];


export function presetById(id: string) {
  return (
    PRESETS.find((preset) => preset.id === id) ??
    null
  );
}
