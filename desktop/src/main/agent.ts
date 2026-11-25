import type {
  Approval,
  ApprovalDecision,
  PermissionMode,
  ProviderId,
  SessionView,
  TodoItem,
  UiItem,
} from "../shared/types.ts";
import { streamModel, type ChatMessage, type StreamRequest, type ToolCall } from "./models.ts";
import { systemPrompt } from "./prompt.ts";
import { contextBudgetChars } from "./providers.ts";
import { stopAllBackground } from "./shell.ts";
import { TOOL_SCHEMAS, toolByName, type ToolContext, type ToolPlan } from "./tools.ts";

// ==========================================
// A CODING SESSION
// ==========================================
//
// One conversation in one folder. The loop: ask the
// model; if it calls tools, plan each, ask the person
// where the mode says to, run it, hand the result
// back; repeat until the model answers without a tool
// call, the person stops it, or the step limit.
//

const MAX_STEPS = 80;

// What a tool result may cost the model's context.
const MAX_RESULT = 30_000;

// What the transcript keeps of one tool's output.
const MAX_SHOWN = 6_000;

export type SessionData = {
  id: string;
  folder: string;
  title: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  items: UiItem[];
  todos: TodoItem[];
  usage: { input: number; output: number };
};

export type ResolvedModel =
  | { error: string }
  | Omit<StreamRequest, "system" | "messages" | "tools" | "signal">;

export type AgentDeps = {
  resolveModel: (value: string) => ResolvedModel;
  mode: () => PermissionMode;
  showThinking: () => boolean;
  save: (data: SessionData) => void;
  emit: (view: SessionView) => void;
  stream?: typeof streamModel;
  prompt?: (root: string) => Promise<string>;
};

function tail(text: string, max: number) {
  return text.length > max ? `...\n${text.slice(-max)}` : text;
}

function head(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}\n... [${text.length - max} more characters]` : text;
}

export class Session {
  data: SessionData;
  running = false;
  approval: Approval | null = null;

  private deps: AgentDeps;
  private controller: AbortController | null = null;
  private answer: ((decision: ApprovalDecision) => void) | null = null;
  private allowedPrefixes = new Set<string>();
  private allowEdits = false;
  private allowNetwork = false;
  private readFiles = new Map<string, number>();
  private backgroundIds: string[] = [];
  private emitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(data: SessionData, deps: AgentDeps) {
    this.data = data;
    this.deps = deps;
    this.repair();
  }

  // A session saved mid-step (the app quit) can end
  // with tool calls that never got results; every API
  // refuses that, so close them off.
  private repair() {
    const messages = this.data.messages;
    const last = messages[messages.length - 1];

    if (last?.role === "assistant" && last.toolCalls?.length) {
      for (const call of last.toolCalls) {
        messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: "Not run: the session was interrupted.",
        });
      }
    }

    for (const item of this.data.items) {
      if (item.kind === "tool" && item.status === "running") {
        item.status = "error";
        item.note = "interrupted";
      }
    }
  }

  view(): SessionView {
    return {
      id: this.data.id,
      title: this.data.title,
      folder: this.data.folder,
      updatedAt: this.data.updatedAt,
      model: this.data.model,
      running: this.running,
      items: this.data.items,
      todos: this.data.todos,
      approval: this.approval,
      usage: this.data.usage,
    };
  }

  private emitNow() {
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }

    this.deps.emit(this.view());
  }

  // Streaming text would otherwise send a snapshot per
  // token; a few a second is plenty to look live.
  private emitSoon() {
    if (this.emitTimer) return;

    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.deps.emit(this.view());
    }, 60);
  }

  private save() {
    this.data.updatedAt = Date.now();
    this.deps.save(this.data);
  }

  private notice(text: string, tone: "info" | "error" = "info") {
    this.data.items.push({ kind: "notice", text, tone });
  }

  setModel(model: string) {
    this.data.model = model;
    this.save();
    this.emitNow();
  }

  stop() {
    this.controller?.abort();
    this.answer?.({ kind: "deny", feedback: "Stopped." });
  }

  dispose() {
    this.stop();
    stopAllBackground(this.backgroundIds);
  }

  respond(requestId: string, decision: ApprovalDecision) {
    if (this.approval?.requestId === requestId && this.answer) {
      this.answer(decision);
    }
  }

  // ----------------------------------------
  // CONTEXT
  // ----------------------------------------
  //
  // A long task outgrows any window. Old tool output is
  // the bulk and the least needed, so it goes first;
  // the model can always run the tool again.

  private trim(provider: ProviderId) {
    const budget = contextBudgetChars(provider);
    const messages = this.data.messages;

    const size = () =>
      messages.reduce(
        (sum, message) =>
          sum +
          message.content.length +
          (message.role === "assistant"
            ? (message.toolCalls ?? []).reduce((n, call) => n + call.arguments.length, 0)
            : 0),
        0
      );

    let total = size();

    if (total <= budget) return;

    const keep = Math.max(0, messages.length - 8);

    for (let index = 0; index < keep && total > budget; index++) {
      const message = messages[index];

      if (message.role === "tool" && message.content.length > 400) {
        total -= message.content.length;
        message.content = "[Old output removed to save room. Run the tool again if you need it.]";
        total += message.content.length;
      }
    }

    for (let index = 0; index < keep && total > budget; index++) {
      const message = messages[index];

      if (message.role === "assistant") {
        for (const call of message.toolCalls ?? []) {
          if (call.arguments.length > 1000) {
            total -= call.arguments.length;
            // Keep it valid JSON for the APIs that parse it.
            call.arguments = JSON.stringify({ note: "[arguments removed to save room]" });
            total += call.arguments.length;
          }
        }

        if (message.content.length > 2000) {
          total -= message.content.length;
          message.content = `${message.content.slice(0, 1500)}\n[... cut to save room]`;
          total += message.content.length;
        }
      }
    }
  }

  // ----------------------------------------
  // THE LOOP
  // ----------------------------------------

  async send(text: string) {
    if (this.running) return;

    const trimmed = text.trim();
    if (!trimmed) return;

    this.running = true;
    this.controller = new AbortController();
    const signal = this.controller.signal;

    this.data.messages.push({ role: "user", content: trimmed });
    this.data.items.push({ kind: "user", text: trimmed });

    if (this.data.title === "New session") {
      this.data.title = trimmed.replace(/\s+/g, " ").slice(0, 70);
    }

    this.save();
    this.emitNow();

    const stream = this.deps.stream ?? streamModel;

    try {
      const system = await (this.deps.prompt ?? systemPrompt)(this.data.folder);

      let step = 0;

      for (; step < MAX_STEPS; step++) {
        if (signal.aborted) break;

        const resolved = this.deps.resolveModel(this.data.model);

        if ("error" in resolved) {
          this.notice(resolved.error, "error");
          break;
        }

        this.trim(resolved.provider);

        let answer = "";
        let thinking = "";
        const calls: ToolCall[] = [];
        let textItem: Extract<UiItem, { kind: "assistant" }> | null = null;
        let thinkItem: Extract<UiItem, { kind: "thinking" }> | null = null;

        try {
          for await (const event of stream({
            ...resolved,
            system,
            messages: this.data.messages,
            tools: TOOL_SCHEMAS,
            signal,
          })) {
            if (event.type === "text") {
              answer += event.delta;

              if (!textItem) {
                textItem = { kind: "assistant", text: "" };
                this.data.items.push(textItem);
              }

              textItem.text = answer;
            } else if (event.type === "thinking") {
              thinking += event.delta;

              if (this.deps.showThinking()) {
                if (!thinkItem) {
                  thinkItem = { kind: "thinking", text: "" };
                  this.data.items.push(thinkItem);
                }

                thinkItem.text = thinking;
              }
            } else if (event.type === "tool-call") {
              calls.push(event.call);
            } else if (event.type === "usage") {
              this.data.usage.input += event.input;
              this.data.usage.output += event.output;
            }

            this.emitSoon();
          }
        } catch (error) {
          // Keep what was said before it stopped.
          if (answer) {
            this.data.messages.push({ role: "assistant", content: `${answer}\n[stopped]` });
          }

          throw error;
        }

        if (signal.aborted) {
          if (answer) this.data.messages.push({ role: "assistant", content: `${answer}\n[stopped]` });
          break;
        }

        // Some models only "think" and then stop. Say so
        // rather than leaving a blank turn.
        if (!answer && !calls.length) {
          this.data.messages.push({ role: "assistant", content: "(no reply)" });
          this.notice("The model returned an empty reply. Try again, or pick another model.", "error");
          break;
        }

        this.data.messages.push({
          role: "assistant",
          content: answer,
          ...(calls.length ? { toolCalls: calls } : {}),
        });

        if (!calls.length) break;

        for (const call of calls) {
          if (signal.aborted) {
            this.data.messages.push({
              role: "tool",
              toolCallId: call.id,
              name: call.name,
              content: "Not run: the user stopped the task.",
            });
            continue;
          }

          const result = await this.runTool(call, signal);

          this.data.messages.push({
            role: "tool",
            toolCallId: call.id,
            name: call.name,
            content: head(result, MAX_RESULT),
          });

          this.save();
          this.emitNow();
        }
      }

      if (step >= MAX_STEPS) {
        this.notice(`Paused after ${MAX_STEPS} steps. Say "continue" to keep going.`);
      }

      if (signal.aborted) {
        this.notice("Stopped.");
      }
    } catch (error) {
      if (signal.aborted) {
        this.notice("Stopped.");
      } else {
        this.notice((error as Error).message || "Something went wrong.", "error");
      }
    } finally {
      this.running = false;
      this.approval = null;
      this.answer = null;
      this.controller = null;
      this.save();
      this.emitNow();
    }
  }

  // ----------------------------------------
  // ONE TOOL CALL
  // ----------------------------------------

  private needsApproval(kind: string, plan: Exclude<ToolPlan, { error: string }>) {
    const mode = this.deps.mode();

    if (kind === "command" && plan.dangerous) return true;
    if (mode === "full-auto") return false;

    if (kind === "edit") return mode === "ask" && !this.allowEdits;
    if (kind === "command") return !plan.readOnly && !this.allowedPrefixes.has(plan.commandPrefix ?? "");
    if (kind === "network") return mode === "ask" && !this.allowNetwork;

    return false;
  }

  private ask(approval: Approval, signal: AbortSignal) {
    return new Promise<ApprovalDecision>((resolve) => {
      const done = (decision: ApprovalDecision) => {
        signal.removeEventListener("abort", onAbort);
        this.approval = null;
        this.answer = null;
        resolve(decision);
      };

      const onAbort = () => done({ kind: "deny", feedback: "Stopped." });

      signal.addEventListener("abort", onAbort, { once: true });

      this.approval = approval;
      this.answer = done;
      this.emitNow();
    });
  }

  private async runTool(call: ToolCall, signal: AbortSignal): Promise<string> {
    const tool = toolByName(call.name);

    const item: Extract<UiItem, { kind: "tool" }> = {
      kind: "tool",
      id: call.id,
      name: call.name,
      summary: call.name,
      status: "running",
    };

    this.data.items.push(item);

    const fail = (message: string) => {
      item.status = "error";
      item.output = message;
      this.emitNow();
      return `Error: ${message}`;
    };

    if (!tool) {
      return fail(`There is no tool called "${call.name}". Use one of: ${TOOL_SCHEMAS.map((t) => t.name).join(", ")}.`);
    }

    let args: Record<string, unknown>;

    try {
      const parsed = JSON.parse(call.arguments || "{}");
      args = parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return fail(`The arguments were not valid JSON: ${call.arguments.slice(0, 200)}`);
    }

    item.summary = tool.summary(args);
    this.emitNow();

    const context: ToolContext = {
      root: this.data.folder,
      signal,
      readFiles: this.readFiles,
      backgroundIds: this.backgroundIds,
      onOutput: (chunk) => {
        item.output = tail((item.output ?? "") + chunk, MAX_SHOWN);
        this.emitSoon();
      },
      setTodos: (todos) => {
        this.data.todos = todos;
      },
    };

    let plan: ToolPlan;

    try {
      plan = await tool.plan(args, context);
    } catch (error) {
      return fail((error as Error).message);
    }

    if ("error" in plan) {
      return fail(plan.error);
    }

    item.summary = plan.title;

    if (this.needsApproval(tool.kind, plan)) {
      const decision = await this.ask(
        {
          requestId: `${call.id}:${Date.now()}`,
          tool: call.name,
          title: plan.title,
          detail: plan.detail,
          detailKind: plan.detailKind ?? "text",
          commandPrefix: tool.kind === "command" && !plan.dangerous ? plan.commandPrefix : undefined,
        },
        signal
      );

      if (decision.kind === "deny") {
        item.status = "denied";
        item.diff = plan.detailKind === "diff" ? plan.detail : undefined;
        this.emitNow();

        return decision.feedback && decision.feedback !== "Stopped."
          ? `The user declined this. Their note: ${decision.feedback}`
          : "The user declined this. Don't retry it as is - adjust your approach or ask them.";
      }

      if (decision.kind === "allow-session") {
        if (tool.kind === "edit") this.allowEdits = true;
        if (tool.kind === "network") this.allowNetwork = true;
        if (tool.kind === "command" && plan.commandPrefix) this.allowedPrefixes.add(plan.commandPrefix);
      }
    }

    try {
      const result = await plan.apply();

      item.status = result.error ? "error" : "ok";
      item.note = result.display;
      item.diff = result.diff;

      // Commands keep their (live) output; the rest show
      // what the model saw, shortened.
      if (tool.kind === "command" && !result.output.startsWith("Started in the background")) {
        item.output = tail(result.output, MAX_SHOWN);
      } else if (!result.diff) {
        item.output = head(result.output, MAX_SHOWN);
      }

      this.emitNow();

      return result.output;
    } catch (error) {
      return fail((error as Error).message);
    }
  }
}

export function newSessionData(folder: string, model: string): SessionData {
  const now = Date.now();

  return {
    id: `s_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    folder,
    title: "New session",
    model,
    createdAt: now,
    updatedAt: now,
    messages: [],
    items: [],
    todos: [],
    usage: { input: 0, output: 0 },
  };
}
