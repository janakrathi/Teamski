import OpenAI from "openai";

import type { ChatChunk, ToolCall } from "../ollama.ts";

import type {
  Provider,
  StreamOptions,
} from "./types.ts";


// ==========================================
// OPENAI
// ==========================================
//
// The closest of the three to what the app
// already speaks: system is a message, tools
// carry a nested function object, and a tool
// result is a message with role "tool". Ollama
// modelled its chat API on this one.
//
// What still differs: a tool call streams its
// arguments as a JSON string in pieces, and
// usage only arrives if it is asked for.
//

export function openaiKey() {
  return process.env.OPENAI_API_KEY || null;
}


export const OPENAI_MODELS = [
  {
    id: "gpt-4.1",
    contextWindow: 1047576,
    label: "GPT-4.1",
    costPerMTokIn: 2,
    costPerMTokOut: 8,
  },
  {
    id: "gpt-4.1-mini",
    contextWindow: 1047576,
    label: "GPT-4.1 mini",
    costPerMTokIn: 0.4,
    costPerMTokOut: 1.6,
  },
  {
    id: "gpt-4o",
    contextWindow: 128000,
    label: "GPT-4o",
    costPerMTokIn: 2.5,
    costPerMTokOut: 10,
  },
];


async function* stream(
  options: StreamOptions
): AsyncGenerator<ChatChunk> {
  const key =
    options.credential?.key ?? openaiKey();

  const baseURL = options.credential?.baseUrl;

  // A server somebody runs themselves often has
  // no key at all, so an address on its own is
  // enough.

  if (!key && !baseURL) {
    throw new Error(
      "No OpenAI API key. Add one in Settings, under Models."
    );
  }

  // Everything that speaks this API at another
  // address - Groq, DeepSeek, OpenRouter, a
  // company's own vLLM - is this client with
  // baseURL pointed elsewhere.

  const client = new OpenAI({
    apiKey: key ?? "not-needed",
    baseURL,

    // The SDK retries a 429 twice with a pause
    // between. For a free Gemini key that is only
    // a slower way to hear "limit reached" - the
    // built-in model answers instead, straight
    // away.
    ...(baseURL?.includes("generativelanguage.googleapis.com")
      ? { maxRetries: 0 }
      : {}),
  });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] =
    options.messages.map((message) => {
      if (message.role === "tool") {
        // OpenAI matches a result to a call by
        // id. The app does not carry one, so the
        // tool name goes in as the id - which is
        // what it has, and is stable within a
        // turn.

        return {
          role: "tool",
          tool_call_id:
            message.tool_name ?? "tool",
          content: message.content,
        };
      }

      // A user turn with images becomes multimodal
      // content: the text, then each image as an
      // image_url part. Groq's vision models read
      // these; a text model given none sees a plain
      // string, exactly as before.

      if (
        message.role === "user" &&
        message.images &&
        message.images.length > 0
      ) {
        return {
          role: "user",
          content: [
            ...(message.content
              ? [
                  {
                    type: "text" as const,
                    text: message.content,
                  },
                ]
              : []),
            ...message.images.map((url) => ({
              type: "image_url" as const,
              image_url: { url },
            })),
          ],
        };
      }

      return {
        role: message.role,
        content: message.content,
      } as OpenAI.Chat.ChatCompletionMessageParam;
    });

  // A tool with no name is unusable - the model
  // cannot call it - and gpt-oss's harmony template
  // (Groq, Cerebras) refuses the entire request over
  // one ("Tools should have a name!"). Some MCP servers
  // expose a nameless tool, so drop it here: this is the
  // one place every OpenAI-compatible caller (chat route
  // and the agent worker alike) converts its tools, so
  // guarding it once covers them all.
  const namedTools = (options.tools ?? []).filter(
    (spec) => Boolean(spec.function?.name)
  );

  const live = await client.chat.completions.create(
    {
      model: options.model,
      messages,

      tools: namedTools.length
        ? namedTools.map((spec) => ({
            type: "function" as const,
            function: {
              name: spec.function.name,
              description:
                spec.function.description,
              parameters:
                spec.function.parameters,
            },
          }))
        : undefined,

      temperature: options.options?.temperature,

      // Gemini thinks before answering unless told
      // not to, and on a chat message that is only
      // a longer wait. 2.5 Flash can switch it off;
      // 3.x can only turn it down.
      ...(!options.think &&
      baseURL?.includes("generativelanguage.googleapis.com")
        ? {
            reasoning_effort: (/^gemini-2\.5-flash/.test(options.model)
              ? "none"
              : "low") as "low",
          }
        : {}),

      stream: true,

      // Usage is not streamed unless asked for,
      // and the app shows token counts.
      stream_options: { include_usage: true },
    },
    { signal: options.signal }
  );

  // Arguments arrive in pieces, keyed by their
  // position in the call list.

  const building = new Map<
    number,
    { name: string; json: string }
  >();

  let promptTokens = 0;
  let responseTokens = 0;
  let reason = "stop";

  for await (const part of live) {
    if (part.usage) {
      promptTokens = part.usage.prompt_tokens ?? 0;

      responseTokens =
        part.usage.completion_tokens ?? 0;
    }

    const choice = part.choices?.[0];

    if (!choice) {
      continue;
    }

    if (choice.finish_reason) {
      reason = choice.finish_reason;
    }

    const delta = choice.delta;

    if (delta?.content) {
      yield {
        message: { content: delta.content },
      };
    }

    for (const call of delta?.tool_calls ?? []) {
      const partial = building.get(call.index) ?? {
        name: "",
        json: "",
      };

      if (call.function?.name) {
        partial.name = call.function.name;
      }

      if (call.function?.arguments) {
        partial.json += call.function.arguments;
      }

      building.set(call.index, partial);
    }
  }

  // Nothing marks a tool call finished mid
  // stream, so they are emitted once the stream
  // ends.

  const calls: ToolCall[] = [];

  for (const partial of building.values()) {
    if (!partial.name) {
      continue;
    }

    let args: Record<string, string> = {};

    try {
      args = partial.json
        ? JSON.parse(partial.json)
        : {};
    } catch {
      // A call whose arguments did not parse is
      // better reported empty than thrown - the
      // tool will say what it needed.
    }

    calls.push({
      function: { name: partial.name, arguments: args },
    });
  }

  if (calls.length > 0) {
    yield { message: { tool_calls: calls } };
  }

  yield {
    done: true,
    done_reason: reason,
    prompt_eval_count: promptTokens,
    eval_count: responseTokens,
  };
}


export const openaiProvider: Provider = {
  id: "openai",
  label: "OpenAI",
  local: false,
  available: () => openaiKey() !== null,
  models: OPENAI_MODELS,
  stream,
};
