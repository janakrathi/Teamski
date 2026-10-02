// ==========================================
// TURNING MODEL FAILURES INTO PLAIN ENGLISH
// ==========================================
//
// A model or provider can fail mid-turn in a dozen
// ways - a rate limit, a request too large, a tool it
// could not use, a provider briefly down - and the raw
// message is written for engineers: "400 failed to
// template request: ... HarmonyError: EncodingError:
// render failed: Tools should have a name!". Shown to a
// person mid-conversation it is noise at best, alarming
// at worst.
//
// Both the chat route and the background worker run
// their model calls through here so the person sees one
// short, useful sentence while the raw text still goes
// to the logs and alerts. Kept deliberately small: it
// classifies by the words providers actually use, and
// falls back to a calm generic line for anything else.
//

import type { OllamaMessage } from "./ollama.ts";


function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error ?? "");
}


// When a tool error forces a retry with no tools, the
// tool call and tool-result messages already in the
// history are themselves the problem: gpt-oss's harmony
// template cannot render a tool call, or a tool result,
// when the request defines no tools - so the retry fails
// the exact same way. This flattens them into plain text
// the model can still read: the assistant's tool call is
// dropped (its words, if any, kept), and each tool result
// becomes a plain message. The retry then has a clean,
// renderable history and can answer from what the tools
// returned.

export function flattenToolMessages(
  messages: OllamaMessage[]
): OllamaMessage[] {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "user",
        content: `Result from ${
          message.tool_name ?? "a tool"
        }:\n${message.content}`,
      };
    }

    if (message.tool_calls) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { tool_calls, ...rest } = message;

      return { ...rest, content: message.content ?? "" };
    }

    return message;
  });
}


// A tool or template failure: the model called a tool
// that was not offered, invented one, or the provider's
// template refused the tool list outright (gpt-oss's
// harmony template does this over a nameless tool). The
// turn can be retried with no tools rather than shown as
// an error, so both callers test for this first.

export function isToolError(error: unknown): boolean {
  const message = messageOf(error);

  return /tool call validation|not in request\.tools|tool_use_failed|failed to call tool|tools should have a name|failed to template request|render failed|harmony|tool choice is none|model called a tool|called a tool/i.test(
    message
  );
}


function isRateLimit(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)
    ?.status;

  return (
    status === 429 ||
    /rate limit|too many requests|quota|429/i.test(
      messageOf(error)
    )
  );
}


function isTooLarge(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)
    ?.status;

  return (
    status === 413 ||
    /too large|413|context length|maximum context|context window|reduce the length|tokens per min/i.test(
      messageOf(error)
    )
  );
}


function isBadKey(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)
    ?.status;

  return (
    status === 401 ||
    status === 403 ||
    /invalid api key|invalid.{0,10}key|unauthorized|authentication|permission denied|401|403/i.test(
      messageOf(error)
    )
  );
}


function isNetwork(error: unknown): boolean {
  return /timeout|timed out|etimedout|econnreset|econnrefused|enotfound|network|fetch failed|socket hang up/i.test(
    messageOf(error) + " " + (error instanceof Error ? error.name : "")
  );
}


// One short sentence for the person. The order matters:
// the most specific, most actionable cause wins.

export function friendlyModelError(error: unknown): string {
  if (
    error instanceof Error &&
    error.name === "DailyLimitError"
  ) {
    // The daily-allowance error already carries a
    // sentence written for the person.
    return error.message;
  }

  if (isBadKey(error)) {
    return "That model's API key was rejected. Check the key in Settings, or switch to a built-in model.";
  }

  if (isRateLimit(error)) {
    return "The AI is handling a lot of requests right now. Give it a few seconds and try again.";
  }

  if (isTooLarge(error)) {
    return "That was a bit much to take in at once. Try a shorter message, or fewer and smaller attachments.";
  }

  if (isToolError(error)) {
    return "The AI had trouble using one of the connected tools for that. Try rephrasing, or turn connected apps off for this message.";
  }

  if (isNetwork(error)) {
    return "The AI didn't respond in time. Please try again in a moment.";
  }

  return "Something went wrong answering that. Please try again in a moment.";
}
