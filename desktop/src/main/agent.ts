import { promises as fs } from "node:fs";

import type {
  Approval,
  ApprovalDecision,
  PermissionMode,
  ProviderId,
  SessionView,
  TodoItem,
  UiItem,
} from "../shared/types.ts";
import { runHooks, type HookEvent, type HookOutcome } from "./hooks.ts";
import { streamModel, type ChatMessage, type StreamRequest, type ToolCall, type ToolSchema } from "./models.ts";
import { systemPrompt } from "./prompt.ts";
import { contextBudgetChars } from "./providers.ts";
import { stopAllBackground } from "./shell.ts";
import { runSubagent } from "./subagent.ts";
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
// Around that loop:
//   - checkpoints: every file the agent changes is
//     kept as it was, per message, so a message can be
//     undone with everything after it
//   - summaries: when the conversation outgrows the
//     model's window, the older part is summarised
//   - hooks: the person's own commands, run at points
//     in the loop (hooks.ts)
//   - MCP: tools from the person's MCP servers
//   - helpers: read-only sub-agents (subagent.ts)
//

const MAX_STEPS = 80;

// What a tool result may cost the model's context.
const MAX_RESULT = 30_000;

// What the transcript keeps of one tool's output.
const MAX_SHOWN = 6_000;

// The most one message's undo may hold.
const MAX_CHECKPOINT_BYTES = 20 * 1024 * 1024;

// Read-only work that can run side by side.
const PARALLEL_SAFE = new Set(["read_file", "list_directory", "glob", "grep", "web_search", "task"]);

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

// What one message changed: each file as it was before
// (null: it didn't exist), keyed by path.
export type Checkpoint = {
  itemIndex: number;
  messageIndex: number;
  files: Record<string, string | null>;
  bytes: number;
  // The task list as it was, so undo rolls it back too.
  todos?: TodoItem[];
  // Too much changed to keep it all; undo is partial.
  partial?: boolean;
};

export type ResolvedModel =
  | { error: string }
  | Omit<StreamRequest, "system" | "messages" | "tools" | "signal">;

export type McpAccess = {
  ensure: () => Promise<void>;
  schemas: () => ToolSchema[];
  call: (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<{ text: string; error: boolean }>;
};

export type AgentDeps = {
  resolveModel: (value: string) => ResolvedModel;
  mode: () => PermissionMode;
  showThinking: () => boolean;
  sandbox: () => Promise<{ enabled: boolean; strong: boolean }>;
  save: (data: SessionData) => void;
  saveCheckpoints?: (id: string, checkpoints: Checkpoint[]) => void;
  emit: (view: SessionView) => void;
  hooksFile?: string;
  mcp?: McpAccess;
  stream?: typeof streamModel;
  prompt?: (root: string) => Promise<string>;
};

function tail(text: string, max: number) {
  return text.length > max ? `...\n${text.slice(-max)}` : text;
}

function head(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}\n... [${text.length - max} more characters]` : text;
}

const SUMMARY_PROMPT = `Summarise the coding session below so that you can carry on the work from the summary alone. Include:
- the user's goal and every request they made, in their words where it matters
- decisions made and why
- each file read or changed, with what changed (exact paths)
- commands run and their outcomes, including errors still unresolved
- the current state, and the next steps
Be specific: keep exact file paths, function names, commands and error messages. Plain text, no preamble.

The session:
`;

export class Session {
  data: SessionData;
  checkpoints: Checkpoint[];
  running = false;
  approval: Approval | null = null;

  private deps: AgentDeps;
  private controller: AbortController | null = null;
  private answer: ((decision: ApprovalDecision) => void) | null = null;
  private allowedPrefixes = new Set<string>();
  private allowedServers = new Set<string>();
  private allowEdits = false;
  private allowNetwork = false;
  private readFiles = new Map<string, number>();
  private backgroundIds: string[] = [];
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private current: Checkpoint | null = null;

  constructor(data: SessionData, deps: AgentDeps, checkpoints: Checkpoint[] = []) {
    this.data = data;
    this.deps = deps;
    this.checkpoints = checkpoints;
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
      undoable: this.checkpoints.map((checkpoint) => checkpoint.itemIndex),
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
    this.deps.saveCheckpoints?.(this.data.id, this.checkpoints);
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
  // HOOKS
  // ----------------------------------------

  private async hook(event: HookEvent, payload: Record<string, unknown>, toolName?: string): Promise<HookOutcome> {
    if (!this.deps.hooksFile) return { blocked: false, reason: "", context: "", warnings: [] };

    const outcome = await runHooks(
      this.deps.hooksFile,
      event,
      { session_id: this.data.id, ...payload },
      this.data.folder,
      toolName
    );

    for (const warning of outcome.warnings) this.notice(warning, "error");
    return outcome;
  }

  // ----------------------------------------
  // CHECKPOINTS AND UNDO
  // ----------------------------------------

  private async remember(file: string) {
    const checkpoint = this.current;
    if (!checkpoint || file in checkpoint.files || checkpoint.partial) return;

    try {
      const before = await fs.readFile(file, "utf8");

      if (checkpoint.bytes + before.length > MAX_CHECKPOINT_BYTES) {
        checkpoint.partial = true;
        return;
      }

      checkpoint.files[file] = before;
      checkpoint.bytes += before.length;
    } catch {
      // Didn't exist: undo deletes it.
      checkpoint.files[file] = null;
    }
  }

  // Put every file back the way it was before the
  // message at itemIndex, and cut the conversation
  // there. Commands' side effects aren't undone.
  async rewind(itemIndex: number): Promise<{ text: string; restored: number } | null> {
    if (this.running) return null;

    const at = this.checkpoints.findIndex((checkpoint) => checkpoint.itemIndex === itemIndex);
    if (at === -1) return null;

    const target = this.checkpoints[at];
    const later = this.checkpoints.slice(at).reverse();
    const restored = new Set<string>();

    // Newest first, so the oldest copy of a file wins.
    for (const checkpoint of later) {
      for (const [file, before] of Object.entries(checkpoint.files)) {
        try {
          if (before === null) await fs.rm(file, { force: true });
          else await fs.writeFile(file, before, "utf8");
          restored.add(file);
          this.readFiles.delete(file);
        } catch {
          // Keep going: put back what can be.
        }
      }
    }

    const item = this.data.items[itemIndex];
    const text = item?.kind === "user" ? item.text : "";

    this.data.messages = this.data.messages.slice(0, target.messageIndex);
    this.data.todos = target.todos ?? [];
    this.data.items = this.data.items.slice(0, itemIndex);
    this.checkpoints = this.checkpoints.slice(0, at);

    if (restored.size || later.some((checkpoint) => checkpoint.partial)) {
      this.notice(
        `Undid ${restored.size} file change${restored.size === 1 ? "" : "s"}${later.some((c) => c.partial) ? " (some changes were too large to keep)" : ""}. Changes made by commands aren't undone.`
      );
    }

    this.save();
    this.emitNow();
    return { text, restored: restored.size };
  }

  // ----------------------------------------
  // CONTEXT
  // ----------------------------------------

  private size(from = 0) {
    return this.data.messages.slice(from).reduce(
      (sum, message) =>
        sum +
        message.content.length +
        (message.role === "assistant"
          ? (message.toolCalls ?? []).reduce((n, call) => n + call.arguments.length, 0)
          : 0),
      0
    );
  }

  // Summarise the older part of the conversation when
  // it nears the window, keeping the recent part word
  // for word. Falls back to dropping old tool output.
  private async compact(resolved: Exclude<ResolvedModel, { error: string }>, signal: AbortSignal) {
    const budget = contextBudgetChars(resolved.provider);
    const messages = this.data.messages;

    if (this.size() <= budget * 0.75 || messages.length < 6) return;

    // The latest cut that keeps the tail under 40% of the
    // budget, at a point where no tool result is
    // separated from its call.
    let cut = -1;

    for (let index = messages.length - 2; index >= 2; index--) {
      const message = messages[index];
      if (message.role === "tool") continue;
      if (this.size(index) > budget * 0.4) break;
      cut = index;
    }

    if (cut === -1) cut = Math.max(2, messages.length - 4);
    while (cut < messages.length && messages[cut].role === "tool") cut++;

    const transcript = messages
      .slice(0, cut)
      .map((message) => {
        if (message.role === "user") return `USER: ${head(message.content, 4000)}`;
        if (message.role === "tool") return `TOOL RESULT (${message.name}): ${head(message.content, 1200)}`;
        const calls = (message.toolCalls ?? []).map((call) => `  -> ${call.name} ${head(call.arguments, 600)}`).join("\n");
        return `ASSISTANT: ${head(message.content, 3000)}${calls ? `\n${calls}` : ""}`;
      })
      .join("\n\n");

    let summary = "";

    try {
      const stream = this.deps.stream ?? streamModel;

      for await (const event of stream({
        ...resolved,
        system: "You write precise working summaries of coding sessions.",
        messages: [{ role: "user", content: SUMMARY_PROMPT + head(transcript, Math.floor(budget * 0.9)) }],
        tools: [],
        signal,
      })) {
        if (event.type === "text") summary += event.delta;
        if (event.type === "usage") {
          this.data.usage.input += event.input;
          this.data.usage.output += event.output;
        }
      }
    } catch {
      summary = "";
    }

    if (!summary.trim()) {
      this.trim(budget);
      return;
    }

    const kept = messages.slice(cut);
    const prefix: ChatMessage[] = [
      { role: "user", content: `[Summary of the conversation so far]\n${summary.trim()}` },
      ...(kept[0]?.role === "user" ? [{ role: "assistant" as const, content: "Understood - carrying on from the summary." }] : []),
    ];

    this.data.messages = [...prefix, ...kept];

    // Messages before the cut are gone, so undo can only
    // reach back to what's left.
    this.checkpoints = this.checkpoints
      .filter((checkpoint) => checkpoint.messageIndex >= cut)
      .map((checkpoint) => ({ ...checkpoint, messageIndex: checkpoint.messageIndex - cut + prefix.length }));

    this.notice("Summarised the earlier conversation to make room. Recent messages are kept word for word.");
    this.emitNow();
  }

  private trim(budget: number) {
    const messages = this.data.messages;
    let total = this.size();
    const keep = Math.max(0, messages.length - 8);

    for (let index = 0; index < keep && total > budget; index++) {
      const message = messages[index];

      if (message.role === "tool" && message.content.length > 400) {
        total -= message.content.length;
        message.content = "[Old output removed to save room. Run the tool again if you need it.]";
        total += message.content.length;
      }
    }
  }

  // ----------------------------------------
  // THE LOOP
  // ----------------------------------------

  async send(text: string) {
    if (this.running) return;

    let trimmed = text.trim();
    if (!trimmed) return;

    this.running = true;
    this.controller = new AbortController();
    const signal = this.controller.signal;

    const itemIndex = this.data.items.length;
    this.data.items.push({ kind: "user", text: trimmed });

    if (this.data.title === "New session") {
      this.data.title = trimmed.replace(/\s+/g, " ").slice(0, 70);
    }

    this.emitNow();

    const prompted = await this.hook("UserPromptSubmit", { prompt: trimmed });

    if (prompted.blocked) {
      this.notice(`A UserPromptSubmit hook stopped this message: ${prompted.reason}`, "error");
      this.running = false;
      this.controller = null;
      this.save();
      this.emitNow();
      return;
    }

    if (prompted.context) trimmed += `\n\n[Context from the user's hook]\n${prompted.context}`;

    this.current = { itemIndex, messageIndex: this.data.messages.length, files: {}, bytes: 0, todos: this.data.todos };
    this.checkpoints.push(this.current);
    this.data.messages.push({ role: "user", content: trimmed });

    this.save();
    this.emitNow();

    const stream = this.deps.stream ?? streamModel;

    try {
      const system = await (this.deps.prompt ?? systemPrompt)(this.data.folder);

      if (this.deps.mcp) await this.deps.mcp.ensure();
      const tools = [...TOOL_SCHEMAS, ...(this.deps.mcp?.schemas() ?? [])];

      let step = 0;
      let stopHooks = 0;

      for (; step < MAX_STEPS; step++) {
        if (signal.aborted) break;

        const resolved = this.deps.resolveModel(this.data.model);

        if ("error" in resolved) {
          this.notice(resolved.error, "error");
          break;
        }

        await this.compact(resolved, signal);

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
            tools,
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
          if (answer) this.data.messages.push({ role: "assistant", content: `${answer}\n[stopped]` });
          throw error;
        }

        if (signal.aborted) {
          if (answer) this.data.messages.push({ role: "assistant", content: `${answer}\n[stopped]` });
          break;
        }

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

        if (!calls.length) {
          // A Stop hook can send the agent back to work
          // (tests still failing, say) - a few times at most.
          const stopped = await this.hook("Stop", { last_message: answer });

          if (stopped.blocked && stopHooks < 3) {
            stopHooks++;
            this.data.messages.push({ role: "user", content: `[A Stop hook says the task isn't done]\n${stopped.reason}` });
            this.notice(`A Stop hook sent the agent back: ${stopped.reason.slice(0, 200)}`);
            continue;
          }

          break;
        }

        const results = calls.every((call) => PARALLEL_SAFE.has(call.name))
          ? await Promise.all(calls.map((call) => this.runTool(call, signal)))
          : await this.sequential(calls, signal);

        calls.forEach((call, index) => {
          this.data.messages.push({
            role: "tool",
            toolCallId: call.id,
            name: call.name,
            content: head(results[index], MAX_RESULT),
          });
        });

        this.save();
        this.emitNow();
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
      // A message that changed no files has nothing to
      // undo, but keeps its checkpoint so the
      // conversation can still be cut there.
      this.current = null;
      this.running = false;
      this.approval = null;
      this.answer = null;
      this.controller = null;
      this.save();
      this.emitNow();
    }
  }

  private async sequential(calls: ToolCall[], signal: AbortSignal) {
    const results: string[] = [];

    for (const call of calls) {
      results.push(signal.aborted ? "Not run: the user stopped the task." : await this.runTool(call, signal));
    }

    return results;
  }

  // ----------------------------------------
  // ONE TOOL CALL
  // ----------------------------------------

  private needsApproval(
    kind: string,
    plan: Exclude<ToolPlan, { error: string }>,
    sandbox: { enabled: boolean; strong: boolean },
    server?: string
  ) {
    const mode = this.deps.mode();

    if (kind === "command" && plan.dangerous) return true;

    // Leaving the sandbox for the network always asks,
    // unless the person allowed that command already.
    if (kind === "command" && plan.network) {
      return mode !== "full-auto" && !this.allowedPrefixes.has(`net:${plan.commandPrefix ?? ""}`);
    }

    if (mode === "full-auto") return false;

    if (kind === "edit") return mode === "ask" && !this.allowEdits;

    if (kind === "command") {
      if (plan.readOnly || this.allowedPrefixes.has(plan.commandPrefix ?? "")) return false;
      // An OS-enforced sandbox makes commands safe to run
      // without asking in auto-edit.
      if (mode === "auto-edit" && plan.sandboxed && sandbox.strong) return false;
      return true;
    }

    if (kind === "network") return mode === "ask" && !this.allowNetwork;
    if (kind === "mcp") return !this.allowedServers.has(server ?? "");

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

      // Parallel calls queue for the one approval card.
      const waitTurn = () => {
        if (this.approval) {
          setTimeout(waitTurn, 100);
          return;
        }
        this.approval = approval;
        this.answer = done;
        this.emitNow();
      };

      waitTurn();
    });
  }

  private async runTool(call: ToolCall, signal: AbortSignal): Promise<string> {
    const isMcp = call.name.startsWith("mcp__");
    const tool = isMcp ? null : toolByName(call.name);

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

    if (!tool && !isMcp) {
      return fail(`There is no tool called "${call.name}". Use one of: ${TOOL_SCHEMAS.map((t) => t.name).join(", ")}.`);
    }

    let args: Record<string, unknown>;

    try {
      const parsed = JSON.parse(call.arguments || "{}");
      args = parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return fail(`The arguments were not valid JSON: ${call.arguments.slice(0, 200)}`);
    }

    const sandbox = await this.deps.sandbox();

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
      sandbox,
      beforeWrite: (file) => this.remember(file),
      runSubagent: (description, prompt, onStep) => this.helper(prompt, signal, (steps, label) => {
        item.note = `${steps} step${steps === 1 ? "" : "s"}`;
        onStep(steps, label);
      }),
    };

    // MCP tools: a plain plan, approved per server.
    let plan: ToolPlan;
    let server = "";

    if (isMcp) {
      server = call.name.split("__")[1] ?? "";
      const label = `${server}: ${call.name.split("__").slice(2).join("__")}`;
      const mcp = this.deps.mcp!;

      plan = {
        title: label,
        detail: JSON.stringify(args, null, 2).slice(0, 4000),
        detailKind: "text",
        apply: async () => {
          const result = await mcp.call(call.name, args, signal);
          return { output: result.text, error: result.error, display: result.error ? "error" : "done" };
        },
      };
    } else {
      item.summary = tool!.summary(args);
      this.emitNow();

      try {
        plan = await tool!.plan(args, context);
      } catch (error) {
        return fail((error as Error).message);
      }
    }

    if ("error" in plan) {
      return fail(plan.error);
    }

    item.summary = plan.title;

    const pre = await this.hook("PreToolUse", { tool_name: call.name, tool_input: args }, call.name);

    if (pre.blocked) {
      item.status = "denied";
      item.note = "blocked by hook";
      this.emitNow();
      return `A PreToolUse hook blocked this call: ${pre.reason}`;
    }

    const kind = isMcp ? "mcp" : tool!.kind;

    if (this.needsApproval(kind, plan, sandbox, server)) {
      const decision = await this.ask(
        {
          requestId: `${call.id}:${Date.now()}`,
          tool: isMcp ? "mcp" : call.name,
          title: plan.title,
          detail: plan.detail,
          detailKind: plan.detailKind ?? "text",
          commandPrefix: kind === "command" && !plan.dangerous ? plan.commandPrefix : isMcp ? server : undefined,
          network: plan.network,
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
        if (kind === "edit") this.allowEdits = true;
        if (kind === "network") this.allowNetwork = true;
        if (kind === "mcp") this.allowedServers.add(server);
        if (kind === "command" && plan.commandPrefix) {
          this.allowedPrefixes.add(plan.network ? `net:${plan.commandPrefix}` : plan.commandPrefix);
        }
      }
    }

    try {
      const result = await plan.apply();

      item.status = result.error ? "error" : "ok";
      item.note = result.display ?? item.note;
      item.diff = result.diff;

      if (kind === "command" && !result.output.startsWith("Started in the background")) {
        item.output = tail(result.output, MAX_SHOWN);
      } else if (!result.diff) {
        item.output = head(result.output, MAX_SHOWN);
      }

      this.emitNow();

      let output = result.output;

      const post = await this.hook(
        "PostToolUse",
        { tool_name: call.name, tool_input: args, tool_response: head(result.output, 10000) },
        call.name
      );

      if (post.blocked) output += `\n\n[Feedback from a PostToolUse hook]\n${post.reason}`;

      return output;
    } catch (error) {
      return fail((error as Error).message);
    }
  }

  private async helper(prompt: string, signal: AbortSignal, onStep: (steps: number, label: string) => void) {
    const resolved = this.deps.resolveModel(this.data.model);
    if ("error" in resolved) return `Error: ${resolved.error}`;

    const result = await runSubagent({
      prompt,
      root: this.data.folder,
      model: resolved,
      signal,
      onStep,
      stream: this.deps.stream,
    });

    this.data.usage.input += result.input;
    this.data.usage.output += result.output;
    return result.report;
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
