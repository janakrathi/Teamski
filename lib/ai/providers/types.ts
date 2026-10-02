import type {
  ChatChunk,
  GenerationOptions,
  OllamaMessage,
  ToolSpec,
} from "../ollama.ts";


// ==========================================
// WHAT EVERY MODEL PROVIDER LOOKS LIKE
// ==========================================
//
// Everything that talks to a model went through
// one Ollama function. Adding a second provider
// means either an if-statement at every call
// site, or one shape they all satisfy. This is
// the shape.
//
// It is deliberately Ollama's shape: streamChat
// takes these arguments and yields these chunks,
// and the rest of the app - the chat route, the
// worker, the memory jobs - already speaks it.
// Making Anthropic and OpenAI translate into it
// is a small amount of work in two files.
// Making the whole app provider-agnostic in the
// abstract would be a rewrite.
//

export type Provider = {
  id: "ollama" | "anthropic" | "openai";

  label: string;

  // Where the work happens. The login page makes
  // a promise about this, and the promise is
  // only true for local.
  local: boolean;

  // Whether this machine can actually reach it.
  // No key means the models are not offered,
  // rather than offered and then failing.
  available: () => boolean;

  models: ModelInfo[];

  stream: (
    options: StreamOptions
  ) => AsyncGenerator<ChatChunk>;
};


export type ModelInfo = {
  id: string;
  label: string;

  // Rough, and only for the ones that bill. Shown
  // so nobody discovers the cost afterwards.
  costPerMTokIn?: number;
  costPerMTokOut?: number;

  // So the composer can say how much of the
  // window a conversation is taking. Absent for
  // a service whose models we do not know.
  contextWindow?: number;
};


// Whose account pays, and where to send it. A
// key from the person's own settings, not from
// the server's environment - the environment
// variables remain as a fallback for a workspace
// one person runs alone.

export type Credential = {
  key: string;

  // Set for everything that is OpenAI's API at
  // another address.
  baseUrl?: string;
};


export type StreamOptions = {
  model: string;

  credential?: Credential;

  messages: OllamaMessage[];
  tools?: ToolSpec[];
  think?: boolean;
  options?: GenerationOptions;
  signal?: AbortSignal;
};


// ------------------------------------------
// SPLITTING THE SYSTEM PROMPT OUT
// ------------------------------------------
//
// Ollama and OpenAI take the system prompt as a
// message in the list. Anthropic takes it as its
// own field, and rejects a system role in
// messages. Both hosted providers also reject an
// empty message list, and neither has Ollama's
// "tool" role in the same shape.
//
// Doing that separation in one place keeps the
// two provider files about the API and not about
// the same rearranging twice.
//

export function splitSystem(
  messages: OllamaMessage[]
) {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .filter(Boolean)
    .join("\n\n");

  const rest = messages.filter(
    (message) => message.role !== "system"
  );

  return { system, rest };
}
