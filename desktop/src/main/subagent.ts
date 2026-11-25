import type { StreamRequest, ToolCall } from "./models.ts";
import { streamModel, type ChatMessage } from "./models.ts";
import { toolByName, type ToolContext } from "./tools.ts";

// ==========================================
// SUB-AGENTS
// ==========================================
//
// The main agent can hand a self-contained research
// job to a helper - "find every place that reads the
// session cookie" - and get back a short report, so
// the big search doesn't fill its own context. Several
// run at once when it starts them in the same step.
//
// Helpers can only look: list, read, glob, grep and
// web search. Nothing they do needs approval, and a
// file they read doesn't count as read for the main
// agent, which still has to read before editing.
//

export const SUBAGENT_TOOLS = ["list_directory", "read_file", "glob", "grep", "web_search"];

const MAX_STEPS = 30;

const SYSTEM = (root: string) => `You are a research helper for a coding agent, working in ${root}. You can only read: list_directory, read_file, glob, grep and web_search. Do the job you're given thoroughly, then reply with a concise report: what you found, with exact file paths and line numbers (path:line), relevant code quoted briefly, and anything uncertain. Don't suggest edits you can't verify. Your final reply is all the main agent will see.`;

export async function runSubagent(options: {
  prompt: string;
  root: string;
  model: Omit<StreamRequest, "system" | "messages" | "tools" | "signal">;
  signal: AbortSignal;
  onStep: (steps: number, label: string) => void;
  stream?: typeof streamModel;
}): Promise<{ report: string; steps: number; input: number; output: number }> {
  const stream = options.stream ?? streamModel;
  const tools = SUBAGENT_TOOLS.map((name) => toolByName(name)!).filter(Boolean);
  const messages: ChatMessage[] = [{ role: "user", content: options.prompt }];

  const context: ToolContext = {
    root: options.root,
    signal: options.signal,
    readFiles: new Map(),
    backgroundIds: [],
    onOutput: () => {},
    setTodos: () => {},
    sandbox: { enabled: true, strong: false },
    beforeWrite: async () => {},
  };

  let steps = 0;
  let input = 0;
  let output = 0;

  for (; steps < MAX_STEPS; steps++) {
    if (options.signal.aborted) break;

    let text = "";
    const calls: ToolCall[] = [];

    for await (const event of stream({
      ...options.model,
      system: SYSTEM(options.root),
      messages,
      tools: tools.map((tool) => tool.schema),
      signal: options.signal,
    })) {
      if (event.type === "text") text += event.delta;
      else if (event.type === "tool-call") calls.push(event.call);
      else if (event.type === "usage") {
        input += event.input;
        output += event.output;
      }
    }

    messages.push({ role: "assistant", content: text, ...(calls.length ? { toolCalls: calls } : {}) });

    if (!calls.length) {
      return { report: text.trim() || "(the helper finished without a report)", steps: steps + 1, input, output };
    }

    // A helper's own calls run side by side: they only read.
    const results = await Promise.all(
      calls.map(async (call) => {
        const tool = SUBAGENT_TOOLS.includes(call.name) ? toolByName(call.name) : undefined;
        if (!tool) return `Error: helpers can only use ${SUBAGENT_TOOLS.join(", ")}.`;

        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.arguments || "{}");
        } catch {
          return "Error: the arguments were not valid JSON.";
        }

        options.onStep(steps + 1, tool.summary(args));

        try {
          const plan = await tool.plan(args, context);
          if ("error" in plan) return `Error: ${plan.error}`;
          const result = await plan.apply();
          return result.output.slice(0, 20000);
        } catch (error) {
          return `Error: ${(error as Error).message}`;
        }
      })
    );

    calls.forEach((call, index) => {
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: results[index] });
    });

    // Keep a long hunt from outgrowing the window.
    const size = messages.reduce((n, message) => n + message.content.length, 0);
    if (size > 120_000) {
      for (const message of messages.slice(0, -6)) {
        if (message.role === "tool" && message.content.length > 400) {
          message.content = "[Old output removed to save room.]";
        }
      }
    }
  }

  const last = [...messages].reverse().find((message) => message.role === "assistant" && message.content.trim());

  return {
    report: options.signal.aborted
      ? "(stopped)"
      : `${last?.content.trim() ?? ""}\n\n[The helper hit its ${MAX_STEPS}-step limit before finishing.]`.trim(),
    steps,
    input,
    output,
  };
}
