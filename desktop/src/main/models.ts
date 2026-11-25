import type { ProviderId, ProviderKind } from "../shared/types.ts";
import { OLLAMA_CONTEXT_TOKENS } from "./providers.ts";

// ==========================================
// TALKING TO MODELS
// ==========================================
//
// One provider-neutral conversation format, and a
// streamer per API that turns it into that API's
// shape and its stream back into the same few
// events: text, thinking, tool calls, usage.
//

export type ToolCall = {
  id: string;
  name: string;
  // The raw JSON the model wrote.
  arguments: string;
};

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type ToolSchema = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool-call"; call: ToolCall }
  | { type: "usage"; input: number; output: number };

export type StreamRequest = {
  provider: ProviderId;
  kind: ProviderKind;
  baseUrl: string;
  key?: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  tools: ToolSchema[];
  streamUsage?: boolean;
  signal?: AbortSignal;
};

export class ModelError extends Error {
  status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

export function streamModel(request: StreamRequest): AsyncGenerator<StreamEvent> {
  if (request.kind === "anthropic") {
    return streamAnthropic(request);
  }

  if (request.kind === "ollama") {
    return streamOllama(request);
  }

  return streamOpenAI(request);
}

// ------------------------------------------
// ERRORS IN PLAIN WORDS
// ------------------------------------------

async function failure(response: Response, provider: string): Promise<ModelError> {
  const body = await response.text().catch(() => "");

  let detail = body.slice(0, 400);

  try {
    const parsed = JSON.parse(body);
    detail =
      parsed?.error?.message ??
      parsed?.message ??
      parsed?.error ??
      detail;

    if (typeof detail !== "string") {
      detail = JSON.stringify(detail).slice(0, 400);
    }
  } catch {
    // Not JSON - keep the text.
  }

  const status = response.status;

  const plain =
    status === 401 || status === 403
      ? `${provider} rejected the key (${status}). Check it in Settings.`
      : status === 404
        ? `${provider} doesn't know that model (404). Pick another in the model menu.`
        : status === 429
          ? `${provider} rate limit reached (429). Wait a moment, or switch model.`
          : status === 413
            ? `The request was too large for ${provider} (413). Start a new session or pick a model with a bigger context.`
            : status === 402
              ? `${provider} needs billing set up on that account (402).`
              : `${provider} returned an error (${status}).`;

  return new ModelError(detail ? `${plain} ${detail}` : plain, status);
}

// ------------------------------------------
// LINE READERS
// ------------------------------------------

async function* lines(body: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) {
        return;
      }

      const { value, done } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let newline: number;

      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        yield line;
      }
    }

    if (buffer.trim()) {
      yield buffer;
    }
  } finally {
    reader.releaseLock();
  }
}

// Server-sent events: the JSON after each "data:".
async function* sseData(body: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  for await (const line of lines(body, signal)) {
    if (!line.startsWith("data:")) {
      continue;
    }

    const data = line.slice(5).trim();

    if (!data || data === "[DONE]") {
      continue;
    }

    try {
      yield JSON.parse(data);
    } catch {
      // A partial or keep-alive line.
    }
  }
}

// ------------------------------------------
// OPENAI-COMPATIBLE
// ------------------------------------------

function toOpenAI(system: string, messages: ChatMessage[]) {
  const out: Record<string, unknown>[] = [{ role: "system", content: system }];

  for (const message of messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: message.content });
    } else if (message.role === "assistant") {
      out.push({
        role: "assistant",
        content: message.content || (message.toolCalls?.length ? null : ""),
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: call.arguments || "{}" },
              })),
            }
          : {}),
      });
    } else {
      out.push({
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.content,
      });
    }
  }

  return out;
}

async function* streamOpenAI(request: StreamRequest): AsyncGenerator<StreamEvent> {
  const url = `${request.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(request.key ? { Authorization: `Bearer ${request.key}` } : {}),
      ...(request.provider === "openrouter"
        ? { "HTTP-Referer": "https://teamski.in", "X-Title": "Teamski" }
        : {}),
    },
    body: JSON.stringify({
      model: request.model,
      messages: toOpenAI(request.system, request.messages),
      ...(request.tools.length
        ? {
            tools: request.tools.map((tool) => ({
              type: "function",
              function: tool,
            })),
            tool_choice: "auto",
          }
        : {}),
      stream: true,
      ...(request.streamUsage ? { stream_options: { include_usage: true } } : {}),
    }),
    signal: request.signal,
  });

  if (!response.ok || !response.body) {
    throw await failure(response, labelOf(request.provider));
  }

  // Tool calls arrive in pieces, keyed by index.
  const calls = new Map<number, ToolCall>();

  for await (const chunk of sseData(response.body, request.signal)) {
    if (chunk.error) {
      throw new ModelError(
        `${labelOf(request.provider)}: ${chunk.error.message ?? JSON.stringify(chunk.error)}`
      );
    }

    const delta = chunk.choices?.[0]?.delta;

    if (delta) {
      const reasoning = delta.reasoning_content ?? delta.reasoning;

      if (typeof reasoning === "string" && reasoning) {
        yield { type: "thinking", delta: reasoning };
      }

      if (typeof delta.content === "string" && delta.content) {
        yield { type: "text", delta: delta.content };
      }

      for (const [position, part] of (delta.tool_calls ?? []).entries()) {
        const index = typeof part.index === "number" ? part.index : position;

        const call = calls.get(index) ?? { id: "", name: "", arguments: "" };

        if (part.id) call.id = part.id;
        if (part.function?.name) call.name += part.function.name;

        if (part.function?.arguments) {
          call.arguments +=
            typeof part.function.arguments === "string"
              ? part.function.arguments
              : JSON.stringify(part.function.arguments);
        }

        calls.set(index, call);
      }
    }

    if (chunk.usage) {
      yield {
        type: "usage",
        input: chunk.usage.prompt_tokens ?? 0,
        output: chunk.usage.completion_tokens ?? 0,
      };
    }
  }

  let n = 0;

  for (const call of [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c)) {
    n++;

    if (!call.name) {
      continue;
    }

    yield {
      type: "tool-call",
      call: { ...call, id: call.id || `call_${Date.now()}_${n}` },
    };
  }
}

// ------------------------------------------
// ANTHROPIC
// ------------------------------------------

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function toAnthropic(messages: ChatMessage[]) {
  type Block = Record<string, unknown>;
  const out: { role: "user" | "assistant"; content: Block[] }[] = [];

  const push = (role: "user" | "assistant", blocks: Block[]) => {
    const last = out[out.length - 1];

    if (last && last.role === role) {
      last.content.push(...blocks);
    } else {
      out.push({ role, content: blocks });
    }
  };

  for (const message of messages) {
    if (message.role === "user") {
      push("user", [{ type: "text", text: message.content || "(empty)" }]);
    } else if (message.role === "assistant") {
      const blocks: Block[] = [];

      if (message.content) {
        blocks.push({ type: "text", text: message.content });
      }

      for (const call of message.toolCalls ?? []) {
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: parseArgs(call.arguments),
        });
      }

      push("assistant", blocks.length ? blocks : [{ type: "text", text: "(no reply)" }]);
    } else {
      push("user", [
        {
          type: "tool_result",
          tool_use_id: message.toolCallId,
          content: message.content || "(no output)",
        },
      ]);
    }
  }

  // Cache everything up to the newest message, so each
  // step of a long task pays for the prefix once.
  const last = out[out.length - 1];

  if (last) {
    const block = last.content[last.content.length - 1];
    block.cache_control = { type: "ephemeral" };
  }

  return out;
}

async function* streamAnthropic(request: StreamRequest): AsyncGenerator<StreamEvent> {
  const url = `${request.baseUrl.replace(/\/+$/, "")}/v1/messages`;

  const tools = request.tools.map((tool, index) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
    ...(index === request.tools.length - 1
      ? { cache_control: { type: "ephemeral" } }
      : {}),
  }));

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": request.key ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: request.model,
      max_tokens: 16_000,
      system: [
        { type: "text", text: request.system, cache_control: { type: "ephemeral" } },
      ],
      messages: toAnthropic(request.messages),
      tools,
      stream: true,
    }),
    signal: request.signal,
  });

  if (!response.ok || !response.body) {
    throw await failure(response, "Anthropic");
  }

  const blocks = new Map<number, { type: string; id?: string; name?: string; json: string }>();
  let input = 0;
  let output = 0;

  for await (const event of sseData(response.body, request.signal)) {
    switch (event.type) {
      case "message_start": {
        const usage = event.message?.usage ?? {};
        input =
          (usage.input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0);
        break;
      }

      case "content_block_start": {
        const block = event.content_block ?? {};
        blocks.set(event.index, {
          type: block.type,
          id: block.id,
          name: block.name,
          json: "",
        });
        break;
      }

      case "content_block_delta": {
        const delta = event.delta ?? {};

        if (delta.type === "text_delta" && delta.text) {
          yield { type: "text", delta: delta.text };
        } else if (delta.type === "thinking_delta" && delta.thinking) {
          yield { type: "thinking", delta: delta.thinking };
        } else if (delta.type === "input_json_delta") {
          const block = blocks.get(event.index);
          if (block) block.json += delta.partial_json ?? "";
        }
        break;
      }

      case "content_block_stop": {
        const block = blocks.get(event.index);

        if (block?.type === "tool_use" && block.name) {
          yield {
            type: "tool-call",
            call: {
              id: block.id ?? `toolu_${Date.now()}`,
              name: block.name,
              arguments: block.json || "{}",
            },
          };
        }
        break;
      }

      case "message_delta": {
        output = event.usage?.output_tokens ?? output;
        break;
      }

      case "error": {
        throw new ModelError(`Anthropic: ${event.error?.message ?? "stream error"}`);
      }
    }
  }

  yield { type: "usage", input, output };
}

// ------------------------------------------
// OLLAMA
// ------------------------------------------
//
// Ollama's own API rather than its OpenAI one, because
// only this one lets the context size be set - left
// at Ollama's default, a long task would be silently
// cut short and the agent would lose the thread.

function toOllama(system: string, messages: ChatMessage[]) {
  const out: Record<string, unknown>[] = [{ role: "system", content: system }];

  for (const message of messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: message.content });
    } else if (message.role === "assistant") {
      out.push({
        role: "assistant",
        content: message.content,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                function: { name: call.name, arguments: parseArgs(call.arguments) },
              })),
            }
          : {}),
      });
    } else {
      out.push({ role: "tool", content: message.content, tool_name: message.name });
    }
  }

  return out;
}

async function* streamOllama(request: StreamRequest): AsyncGenerator<StreamEvent> {
  const url = `${request.baseUrl.replace(/\/+$/, "")}/api/chat`;

  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        messages: toOllama(request.system, request.messages),
        tools: request.tools.map((tool) => ({ type: "function", function: tool })),
        stream: true,
        options: { num_ctx: OLLAMA_CONTEXT_TOKENS },
      }),
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal?.aborted) throw error;

    throw new ModelError(
      `Couldn't reach Ollama at ${request.baseUrl}. Is it running? (Install from ollama.com, then run "ollama serve".)`
    );
  }

  if (!response.ok || !response.body) {
    throw await failure(response, "Ollama");
  }

  let n = 0;

  for await (const line of lines(response.body, request.signal)) {
    if (!line.trim()) {
      continue;
    }

    let chunk: {
      message?: {
        content?: string;
        thinking?: string;
        tool_calls?: { function?: { name?: string; arguments?: unknown } }[];
      };
      error?: string;
      done?: boolean;
      prompt_eval_count?: number;
      eval_count?: number;
    };

    try {
      chunk = JSON.parse(line);
    } catch {
      continue;
    }

    if (chunk.error) {
      throw new ModelError(`Ollama: ${chunk.error}`);
    }

    if (chunk.message?.thinking) {
      yield { type: "thinking", delta: chunk.message.thinking };
    }

    if (chunk.message?.content) {
      yield { type: "text", delta: chunk.message.content };
    }

    for (const call of chunk.message?.tool_calls ?? []) {
      if (!call.function?.name) continue;

      n++;

      yield {
        type: "tool-call",
        call: {
          id: `ollama_${Date.now()}_${n}`,
          name: call.function.name,
          arguments:
            typeof call.function.arguments === "string"
              ? call.function.arguments
              : JSON.stringify(call.function.arguments ?? {}),
        },
      };
    }

    if (chunk.done) {
      yield {
        type: "usage",
        input: chunk.prompt_eval_count ?? 0,
        output: chunk.eval_count ?? 0,
      };
    }
  }
}

// ------------------------------------------
// MODEL LISTS
// ------------------------------------------

const NOT_CHAT = /whisper|tts|embed|guard|moderation|dall-e|image|audio|transcribe|realtime|rerank|vision-preview|search-preview/i;

export async function listModels(options: {
  provider: ProviderId;
  kind: ProviderKind;
  baseUrl: string;
  key?: string;
}): Promise<string[]> {
  const base = options.baseUrl.replace(/\/+$/, "");

  if (options.kind === "ollama") {
    const response = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw await failure(response, "Ollama");
    const data = (await response.json()) as { models?: { name: string }[] };
    return (data.models ?? []).map((model) => model.name).sort();
  }

  if (options.kind === "anthropic") {
    const response = await fetch(`${base}/v1/models?limit=100`, {
      headers: { "x-api-key": options.key ?? "", "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw await failure(response, "Anthropic");
    const data = (await response.json()) as { data?: { id: string }[] };
    return (data.data ?? []).map((model) => model.id);
  }

  const response = await fetch(`${base}/models`, {
    headers: options.key ? { Authorization: `Bearer ${options.key}` } : {},
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) throw await failure(response, labelOf(options.provider));

  const data = (await response.json()) as { data?: { id: string }[]; models?: { name: string }[] };

  const ids = (data.data ?? []).map((model) => model.id);

  return ids
    .map((id) => id.replace(/^models\//, ""))
    .filter((id) => !NOT_CHAT.test(id))
    .sort();
}

function labelOf(provider: ProviderId) {
  const names: Partial<Record<ProviderId, string>> = {
    openai: "OpenAI",
    google: "Gemini",
    groq: "Groq",
    cerebras: "Cerebras",
    openrouter: "OpenRouter",
    deepseek: "DeepSeek",
    mistral: "Mistral",
    xai: "xAI",
    custom: "The custom server",
  };

  return names[provider] ?? provider;
}
