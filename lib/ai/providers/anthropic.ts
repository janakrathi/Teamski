import Anthropic from "@anthropic-ai/sdk";

import type { ChatChunk, ToolCall } from "../ollama.ts";

import {
  splitSystem,
  type Provider,
  type StreamOptions,
} from "./types.ts";


// ==========================================
// CLAUDE
// ==========================================
//
// Translates the app's Ollama-shaped calls into
// the Messages API and the stream back again.
//
// Three things differ enough to be worth naming:
//
//   The system prompt is its own field, not a
//   message. A system role inside messages is a
//   400.
//
//   Tools carry input_schema, not a nested
//   function object, and a tool result is a
//   content block inside a user message rather
//   than a message with role "tool".
//
//   Thinking is adaptive. budget_tokens, which
//   older code reaches for, is rejected outright
//   on current models.
//

// Streaming, so a long answer does not run into
// an HTTP timeout.

const MAX_TOKENS = 16000;


function isHaiku(model: string) {
  return /haiku/i.test(model);
}


export function anthropicKey() {
  return process.env.ANTHROPIC_API_KEY || null;
}


export const ANTHROPIC_MODELS = [
  {
    id: "claude-opus-5-5",
    contextWindow: 1000000,
    label: "Claude Opus 5.5",
    costPerMTokIn: 4,
    costPerMTokOut: 20,
  },
  {
    id: "claude-sonnet-5-5",
    contextWindow: 1000000,
    label: "Claude Sonnet 5.5",
    costPerMTokIn: 2,
    costPerMTokOut: 10,
  },
  {
    id: "claude-opus-5",
    contextWindow: 1000000,
    label: "Claude Opus 5",
    costPerMTokIn: 5,
    costPerMTokOut: 25,
  },
  {
    id: "claude-sonnet-5",
    contextWindow: 1000000,
    label: "Claude Sonnet 5",
    costPerMTokIn: 2,
    costPerMTokOut: 10,
  },
  {
    id: "claude-haiku-4-5",
    contextWindow: 200000,
    label: "Claude Haiku 4.5",
    costPerMTokIn: 1,
    costPerMTokOut: 5,
  },
];


async function* stream(
  options: StreamOptions
): AsyncGenerator<ChatChunk> {
  // The person's own key first. The environment
  // variable is the fallback for a workspace one
  // person runs by themselves.

  const key =
    options.credential?.key ?? anthropicKey();

  if (!key) {
    throw new Error(
      "No Anthropic API key. Add one in Settings, under Models."
    );
  }

  const client = new Anthropic({ apiKey: key });

  const { stable, volatile, rest } = splitSystem(
    options.messages
  );

  // A tool result is a content block in a user
  // message here, not a message of its own.

  const messages: Anthropic.MessageParam[] = rest.map(
    (message) => {
      if (message.role === "tool") {
        return {
          role: "user",

          content: [
            {
              type: "text",
              text: `Result from ${
                message.tool_name ?? "a tool"
              }:\n${message.content}`,
            },
          ],
        };
      }

      return {
        role:
          message.role === "assistant"
            ? "assistant"
            : "user",

        content: message.content || "…",
      };
    }
  );

  // Drop any nameless tool (some MCP servers expose
  // one): unusable, and a provider may refuse the whole
  // request over it.
  const named = (options.tools ?? []).filter((spec) =>
    Boolean(spec.function?.name)
  );

  const tools: Anthropic.Tool[] | undefined = named.length
    ? named.map((spec) => ({
        name: spec.function.name,
        description: spec.function.description,
        input_schema:
          spec.function.parameters as Anthropic.Tool["input_schema"],
      }))
    : undefined;

  // Prompt caching. An agent turn sends the whole prompt
  // again at every tool step, and most of it - the tools,
  // the rules, the conversation so far - is the same as
  // last time. Cached input costs a tenth of the normal
  // price (writing it costs 1.25x, once), so:
  //
  //   - the stable part of the system prompt is marked,
  //     which caches the tools and rules ahead of it;
  //   - what changes every turn (summary, memory found
  //     for this message) comes after that mark;
  //   - top-level caching covers the growing
  //     conversation, so step two of a turn reads step
  //     one's prompt from the cache.
  //
  // Short prompts below the model's minimum simply
  // aren't cached - no error, no charge.

  const system: Anthropic.TextBlockParam[] = [];

  if (stable) {
    system.push({
      type: "text",
      text: stable,
      cache_control: { type: "ephemeral" },
    });
  }

  if (volatile) {
    system.push({ type: "text", text: volatile });
  }

  const live = client.messages.stream(
    {
      model: options.model,
      max_tokens: MAX_TOKENS,
      system: system.length ? system : undefined,
      messages,
      tools: tools?.length ? tools : undefined,
      cache_control: { type: "ephemeral" },

      // Adaptive is the only on-mode on current
      // models. summarized because the app has a
      // reasoning panel to put it in; the default
      // returns empty thinking blocks and looks
      // like a long pause. Haiku 4.5 predates
      // adaptive thinking and refuses it, so it runs
      // without.
      ...(isHaiku(options.model)
        ? {}
        : {
            thinking: {
              type: "adaptive" as const,
              display: "summarized" as const,
            },
          }),
    },
    { signal: options.signal }
  );

  // Tool arguments arrive as a JSON string in
  // pieces, so they are collected per block and
  // parsed when the block closes.

  const building = new Map<
    number,
    { name: string; json: string }
  >();

  let promptTokens = 0;
  let responseTokens = 0;

  for await (const event of live) {
    if (
      event.type === "content_block_start" &&
      event.content_block.type === "tool_use"
    ) {
      building.set(event.index, {
        name: event.content_block.name,
        json: "",
      });
    }

    if (event.type === "content_block_delta") {
      const delta = event.delta;

      if (delta.type === "text_delta") {
        yield {
          message: { content: delta.text },
        };
      }

      if (delta.type === "thinking_delta") {
        yield {
          message: { thinking: delta.thinking },
        };
      }

      if (delta.type === "input_json_delta") {
        const partial = building.get(event.index);

        if (partial) {
          partial.json += delta.partial_json;
        }
      }
    }

    if (event.type === "content_block_stop") {
      const partial = building.get(event.index);

      if (partial) {
        building.delete(event.index);

        let args: Record<string, string> = {};

        try {
          args = partial.json
            ? JSON.parse(partial.json)
            : {};
        } catch {
          // A tool call whose arguments did not
          // parse is better reported as an empty
          // call than as a crash - the tool will
          // say what it needed.
        }

        const call: ToolCall = {
          function: {
            name: partial.name,
            arguments: args,
          },
        };

        yield { message: { tool_calls: [call] } };
      }
    }

    if (event.type === "message_start") {
      const usage = event.message.usage;

      const fresh = usage.input_tokens ?? 0;
      const written = usage.cache_creation_input_tokens ?? 0;
      const read = usage.cache_read_input_tokens ?? 0;

      // input_tokens counts only what came after the
      // last cache mark. The spend report counts the
      // whole prompt at what it actually cost: fresh at
      // full price, cache writes at 1.25x, reads at 0.1x.
      promptTokens = Math.round(fresh + written * 1.25 + read * 0.1);

      if (read > 0 || written > 0) {
        console.log(
          `[cache] ${options.model}: ${read} read, ${written} written, ${fresh} fresh`
        );
      }
    }

    if (event.type === "message_delta") {
      responseTokens =
        event.usage.output_tokens ?? 0;
    }
  }

  const final = await live.finalMessage();

  // A safety decline arrives as a 200 with a
  // refusal stop reason, not as an error, so it
  // has to be checked rather than caught.

  if (final.stop_reason === "refusal") {
    yield {
      message: {
        content:
          "\n\nClaude declined to answer this one.",
      },
    };
  }

  yield {
    done: true,
    done_reason: final.stop_reason ?? "stop",
    prompt_eval_count: promptTokens,
    eval_count: responseTokens,
  };
}


export const anthropicProvider: Provider = {
  id: "anthropic",
  label: "Anthropic",
  local: false,
  available: () => anthropicKey() !== null,
  models: ANTHROPIC_MODELS,
  stream,
};
