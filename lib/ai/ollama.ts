import { plainSystem } from "./providers/types.ts";

// ==========================================
// OLLAMA CLIENT
// ==========================================
//
// Every call to the self-hosted model goes
// through this file so the host, model name
// and defaults live in exactly one place.
//

export const OLLAMA_HOST =
  process.env.OLLAMA_HOST ||
  "http://127.0.0.1:11434";

export const DEFAULT_MODEL =
  process.env.OLLAMA_MODEL || "qwen3:1.7b";

// A smaller / faster model can be used for
// background work (summaries, memory, titles).
// Falls back to the main model.

export const UTILITY_MODEL =
  process.env.OLLAMA_UTILITY_MODEL ||
  DEFAULT_MODEL;

// The context window to ask for.
//
// This has to fit in whatever memory is left
// after the weights, and Ollama silently caps it
// rather than refusing - so a prompt budgeted for
// more than was granted is quietly truncated.
//
// Measured on a 4GB card:
//
//   qwen3:1.7b @  8192  ->  100% on GPU
//   qwen3:1.7b @ 16384  ->   71% on GPU
//   qwen3:4b   @  4096  ->   67% on GPU
//
// Hence the default pairing below. On a larger
// card, raise both.

export const NUM_CTX =
  Number(process.env.OLLAMA_NUM_CTX) || 8192;


// The small model that turns text into a vector,
// for semantic memory. Runs locally like the chat
// model, so it needs no key and no external call -
// pull it once with `ollama pull nomic-embed-text`.
// Its output width is fixed, and the database
// column is declared to match; changing the model
// means changing both.

export const EMBED_MODEL =
  process.env.OLLAMA_EMBED_MODEL ||
  "nomic-embed-text";

export const EMBED_DIM = 768;


// One vector for one piece of text, or null when
// the embedder is unreachable or the model is not
// pulled - the caller then falls back to plain
// recency rather than failing.

export async function embed(
  text: string,
  signal?: AbortSignal
): Promise<number[] | null> {
  try {
    const response = await fetch(
      `${OLLAMA_HOST}/api/embeddings`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: EMBED_MODEL,
          prompt: text,
        }),
        signal,
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      embedding?: number[];
    };

    const vector = data.embedding;

    return Array.isArray(vector) &&
      vector.length === EMBED_DIM
      ? vector
      : null;
  } catch {
    return null;
  }
}


export type ChatRole =
  | "system"
  | "user"
  | "assistant"
  | "tool";

export type ToolCall = {
  function: {
    name: string;
    arguments: Record<string, string>;
  };
};

export type OllamaMessage = {
  role: ChatRole;
  content: string;
  tool_name?: string;
  tool_calls?: ToolCall[];

  // Image data URLs ("data:image/png;base64,...")
  // for a vision model. Only the OpenAI-compatible
  // provider sends these on; text-only models and
  // the local machine ignore them.
  images?: string[];
};

export type ToolSpec = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
};

export type GenerationOptions = {
  temperature?: number;
  top_p?: number;
  num_ctx?: number;
  num_predict?: number;
};

export type ChatChunk = {
  message?: {
    role?: string;
    content?: string;
    thinking?: string;
    tool_calls?: ToolCall[];
  };
  done?: boolean;
  done_reason?: string;
  eval_count?: number;
  prompt_eval_count?: number;
  total_duration?: number;
};


// ==========================================
// HOW BUSY THE MACHINE IS
// ==========================================
//
// Ollama on a CPU answers one request at a time,
// so a reply that starts while others are running
// waits for them. Counted here, in this process,
// so the chat can say "you're in line" instead of
// showing nothing for a minute. Background agent
// tasks run in the worker and are not counted -
// this undercounts, it never overcounts.
//

let running = 0;

export function localBusy() {
  return running;
}

async function* counted<T>(
  inner: AsyncGenerator<T>
): AsyncGenerator<T> {
  running++;

  try {
    yield* inner;
  } finally {
    running--;
  }
}


// ==========================================
// ERRORS
// ==========================================

export class OllamaUnreachableError extends Error {
  constructor(host: string) {
    super(
      "Could not reach Ollama at " +
        host +
        '. Start it with "ollama serve" and make ' +
        'sure the model is pulled ("ollama pull ' +
        DEFAULT_MODEL +
        '").'
    );

    this.name = "OllamaUnreachableError";
  }
}


// ==========================================
// HEALTH
// ==========================================

export type OllamaStatus = {
  online: boolean;
  models: string[];
  model: string;
  modelReady: boolean;
  host: string;
  error?: string;
};

export async function getOllamaStatus(): Promise<OllamaStatus> {
  try {
    const response = await fetch(
      `${OLLAMA_HOST}/api/tags`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      }
    );

    if (!response.ok) {
      return {
        online: false,
        models: [],
        model: DEFAULT_MODEL,
        modelReady: false,
        host: OLLAMA_HOST,
        error: `Ollama replied ${response.status}.`,
      };
    }

    const data = (await response.json()) as {
      models?: { name: string }[];
    };

    const models = (data.models ?? []).map(
      (entry) => entry.name
    );

    return {
      online: true,
      models,
      model: DEFAULT_MODEL,
      modelReady: models.some(
        (name) =>
          name === DEFAULT_MODEL ||
          name.split(":")[0] ===
            DEFAULT_MODEL.split(":")[0]
      ),
      host: OLLAMA_HOST,
    };
  } catch {
    return {
      online: false,
      models: [],
      model: DEFAULT_MODEL,
      modelReady: false,
      host: OLLAMA_HOST,
      error: `Could not reach Ollama at ${OLLAMA_HOST}.`,
    };
  }
}


// ==========================================
// STREAMING CHAT
// ==========================================
//
// Yields raw Ollama chunks. Callers decide
// what to do with tokens, thinking and tool
// calls.
//

async function* streamChatInner(options: {
  model?: string;
  messages: OllamaMessage[];
  tools?: ToolSpec[];
  think?: boolean;
  options?: GenerationOptions;
  signal?: AbortSignal;
}): AsyncGenerator<ChatChunk> {

  let response: Response;

  try {
    response = await fetch(
      `${OLLAMA_HOST}/api/chat`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          model: options.model || DEFAULT_MODEL,
          // The marker that sets off the per-turn part of
          // the system prompt is for providers that cache;
          // here it is just a blank line.
          messages: options.messages.map((message) =>
            message.role === "system"
              ? { ...message, content: plainSystem(message.content) }
              : message
          ),
          tools: options.tools,

          // Thinking is off unless asked for. It
          // used to be always on, because older
          // Ollama let qwen3 spill its reasoning
          // into the answer when told not to
          // think. Current Ollama (0.33) turns it
          // off cleanly, and on a CPU server the
          // hidden reasoning was the biggest wait
          // of all: 170-450 tokens, 7-19 seconds
          // of blank screen before the first word.

          think: options.think ?? false,

          stream: true,

          options: {
            temperature: 0.7,
            num_ctx: NUM_CTX,
            ...options.options,
          },
        }),

        signal: options.signal,
      }
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      throw error;
    }

    throw new OllamaUnreachableError(OLLAMA_HOST);
  }

  if (!response.ok || !response.body) {
    const detail = await response
      .text()
      .catch(() => "");

    throw new Error(
      detail ||
        `Ollama returned ${response.status}.`
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, {
      stream: true,
    });

    const lines = buffer.split("\n");

    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed) {
        continue;
      }

      try {
        yield JSON.parse(trimmed) as ChatChunk;
      } catch {
        // Ignore partial or malformed lines.
      }
    }
  }

  if (buffer.trim()) {
    try {
      yield JSON.parse(buffer.trim()) as ChatChunk;
    } catch {
      // Nothing usable left in the buffer.
    }
  }
}


export function streamChat(
  options: Parameters<typeof streamChatInner>[0]
) {
  return counted(streamChatInner(options));
}


// ==========================================
// ONE-SHOT COMPLETION
// ==========================================
//
// Used by background jobs (summaries, titles,
// memory extraction) where streaming would
// only add noise.
//

// Background jobs ask for a JSON shape rather
// than prose. This matters more than it looks:
// asked for prose, qwen3 reasons in circles and
// never reaches an answer - 4000 tokens and nine
// minutes still produced an empty reply. Given a
// schema it answers in about forty tokens,
// because the grammar leaves no room to
// deliberate.

async function completeJsonInner<T>(options: {
  model?: string;
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  temperature?: number;
  numPredict?: number;
  signal?: AbortSignal;
}): Promise<T | null> {

  let response: Response;

  try {
    response = await fetch(
      `${OLLAMA_HOST}/api/chat`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          model: options.model || UTILITY_MODEL,

          messages: [
            {
              role: "system",
              content: options.system,
            },
            {
              role: "user",
              content: options.prompt,
            },
          ],

          // The schema does the constraining, so
          // there is nothing to gain from letting
          // the model think first.

          think: false,

          format: options.schema,

          stream: false,

          options: {
            temperature:
              options.temperature ?? 0.2,
            num_predict:
              options.numPredict ?? 400,

            // The same window as chat. Any other
            // size makes Ollama reload the model
            // to change it - and reload it again
            // for the next chat message. Measured:
            // two reloads after every reply, about
            // 2.5 seconds each on the server.
            num_ctx: NUM_CTX,
          },
        }),

        signal:
          options.signal ??
          AbortSignal.timeout(90_000),
      }
    );
  } catch {
    throw new OllamaUnreachableError(OLLAMA_HOST);
  }

  if (!response.ok) {
    throw new Error(
      `Ollama returned ${response.status}.`
    );
  }

  const data = (await response.json()) as {
    message?: { content?: string };
  };

  const raw = (data.message?.content || "").trim();

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    console.error(
      "Model returned invalid JSON:",
      raw.slice(0, 200)
    );

    return null;
  }
}


// ==========================================
// STRIP THINKING TAGS
// ==========================================
//
// Qwen sometimes emits reasoning inline even
// when thinking is disabled. We only remove
// the tagged blocks - never guess at which
// paragraph was "the real answer", because
// that mangles legitimate replies.
//

export function stripThinking(content: string) {
  if (!content) {
    return "";
  }

  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "")
    .replace(/<\/think>/gi, "")
    .replace(
      /<\|think\|>[\s\S]*?<\|\/think\|>/gi,
      ""
    )
    .replace(/<\|think\|>[\s\S]*$/gi, "")
    .trim();
}


// ==========================================
// ROUGH TOKEN ESTIMATE
// ==========================================
//
// Good enough for budgeting a context window
// without pulling in a tokenizer.
//

export function estimateTokens(text: string) {
  return Math.ceil((text || "").length / 3.6);
}


export async function completeJson<T>(
  options: Parameters<typeof completeJsonInner>[0]
): Promise<T | null> {
  running++;

  try {
    return await completeJsonInner<T>(options);
  } finally {
    running--;
  }
}
