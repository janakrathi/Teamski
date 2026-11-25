import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { detectShell } from "./shell.ts";

// ==========================================
// HOOKS
// ==========================================
//
// Shell commands the person sets up to run at points
// in the agent's loop - Claude Code's format, so the
// same hooks work in both:
//
//   { "hooks": {
//       "PreToolUse":  [{ "matcher": "edit_file|write_file",
//                         "hooks": [{ "type": "command", "command": "node check.js" }] }],
//       "PostToolUse": [{ "matcher": "edit_file", "hooks": [{ "type": "command", "command": "npx prettier --write ." }] }],
//       "UserPromptSubmit": [...],
//       "Stop": [...]
//   } }
//
// Each hook gets the event as JSON on stdin. Exit code
// 2 means "no": the tool call is blocked (PreToolUse),
// the prompt is refused (UserPromptSubmit), or the
// agent is told to keep going (Stop) - with stderr as
// the reason. For PostToolUse, exit 2's stderr is
// passed back to the model. Other exit codes are only
// shown. Like mcp.json, the file is the person's, not
// a project's.
//

export type HookEvent = "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "Stop";

type HookConfig = {
  hooks?: Partial<Record<HookEvent, { matcher?: string; hooks: { type: string; command: string; timeout?: number }[] }[]>>;
};

export type HookOutcome = {
  blocked: boolean;
  // stderr of a blocking hook.
  reason: string;
  // stdout of hooks that exited 0 (extra context).
  context: string;
  // Problems worth showing the person.
  warnings: string[];
};

export const HOOKS_TEMPLATE = `{
  "hooks": {
    "PreToolUse": [],
    "PostToolUse": [],
    "UserPromptSubmit": [],
    "Stop": []
  }
}
`;

function read(file: string): HookConfig {
  if (!existsSync(file)) return {};

  try {
    return JSON.parse(readFileSync(file, "utf8")) as HookConfig;
  } catch {
    return {};
  }
}

function matches(matcher: string | undefined, toolName: string | undefined) {
  if (!matcher || matcher === "*" || !toolName) return true;

  try {
    return new RegExp(`^(?:${matcher})$`).test(toolName);
  } catch {
    return matcher === toolName;
  }
}

function runOne(command: string, input: string, cwd: string, timeoutMs: number) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const shell = detectShell();
    const child = spawn(shell.file, shell.args(command), { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => (stdout += data.toString("utf8")));
    child.stderr.on("data", (data: Buffer) => (stderr += data.toString("utf8")));

    const timer = setTimeout(() => {
      child.kill();
      stderr += `\n(timed out after ${timeoutMs / 1000}s)`;
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}\n${error.message}` });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: stdout.slice(0, 20000), stderr: stderr.slice(0, 20000) });
    });

    child.stdin.end(input);
  });
}

export async function runHooks(
  file: string,
  event: HookEvent,
  payload: Record<string, unknown>,
  cwd: string,
  toolName?: string
): Promise<HookOutcome> {
  const outcome: HookOutcome = { blocked: false, reason: "", context: "", warnings: [] };
  const groups = read(file).hooks?.[event] ?? [];

  for (const group of groups) {
    if (!matches(group.matcher, toolName)) continue;

    for (const hook of group.hooks ?? []) {
      if (hook.type !== "command" || !hook.command) continue;

      const result = await runOne(
        hook.command,
        JSON.stringify({ hook_event_name: event, cwd, ...payload }),
        cwd,
        Math.min(600, hook.timeout ?? 60) * 1000
      );

      if (result.code === 2) {
        outcome.blocked = true;
        outcome.reason += `${result.stderr.trim() || "A hook said no."}\n`;
      } else if (result.code === 0) {
        if (result.stdout.trim()) outcome.context += `${result.stdout.trim()}\n`;
      } else {
        outcome.warnings.push(`${event} hook "${hook.command}" exited ${result.code}: ${result.stderr.trim().slice(0, 300)}`);
      }
    }
  }

  outcome.reason = outcome.reason.trim();
  outcome.context = outcome.context.trim();
  return outcome;
}
