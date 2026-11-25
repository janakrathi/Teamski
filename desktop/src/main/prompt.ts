import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { detectShell } from "./shell.ts";

// ==========================================
// THE CODING AGENT'S BRIEF
// ==========================================
//
// What the model knows before the first message:
// how to work, where it is (OS, shell, folder, git),
// and the project's own instructions - AGENTS.md,
// CLAUDE.md and friends, which many repos already
// carry for coding agents.
//

const INSTRUCTION_FILES = ["TEAMSKI.md", "AGENTS.md", "CLAUDE.md", ".cursorrules", ".github/copilot-instructions.md"];

const MAX_INSTRUCTIONS = 24_000;

function git(args: string[], cwd: string) {
  return new Promise<string>((resolve) => {
    execFile("git", args, { cwd, timeout: 8000, windowsHide: true }, (error, stdout) => {
      resolve(error ? "" : String(stdout).trim());
    });
  });
}

async function projectInstructions(root: string) {
  const parts: string[] = [];
  let used = 0;

  for (const name of INSTRUCTION_FILES) {
    try {
      const text = (await fs.readFile(path.join(root, name), "utf8")).trim();
      if (!text) continue;

      const room = MAX_INSTRUCTIONS - used;
      if (room <= 0) break;

      const kept = text.length > room ? `${text.slice(0, room)}\n[cut]` : text;
      parts.push(`<file name="${name}">\n${kept}\n</file>`);
      used += kept.length;
    } catch {
      // Not there.
    }
  }

  return parts.join("\n\n");
}

async function topLevel(root: string) {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => !entry.name.startsWith(".") || entry.name === ".github")
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .slice(0, 60)
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
      .join("  ");
  } catch {
    return "";
  }
}

export async function systemPrompt(root: string) {
  const shell = detectShell();

  const [branch, status, log, instructions, listing] = await Promise.all([
    git(["rev-parse", "--abbrev-ref", "HEAD"], root),
    git(["status", "--short"], root),
    git(["log", "--oneline", "-5"], root),
    projectInstructions(root),
    topLevel(root),
  ]);

  const platform =
    process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : process.platform;

  const statusLines = status.split("\n").filter(Boolean);

  const gitSection = branch
    ? `Git branch: ${branch}
Recent commits:
${log || "(none)"}
Uncommitted changes:
${statusLines.length ? statusLines.slice(0, 30).join("\n") + (statusLines.length > 30 ? `\n... and ${statusLines.length - 30} more` : "") : "(clean)"}`
    : "Not a git repository.";

  return `You are Teamski Code, an expert software engineer working as a coding agent on the user's own computer. You have tools to read, search and edit files in the project folder and to run commands. You do the work yourself - you don't tell the user to do it.

# How you work
- Understand before changing. Find the relevant code with glob and grep, and read files before editing them. Never guess at a file's contents or an API you haven't seen.
- For anything beyond a small change, write a short plan with todo_write and keep it current: one task in_progress, mark each completed when it's done.
- Make focused changes that do what was asked - no unrelated refactors, renames or reformatting. Match the existing style, naming, libraries and patterns of the codebase. Don't add new dependencies unless needed.
- Prefer edit_file for changes to existing files; use write_file only for new files or complete rewrites.
- Verify your work: run the project's tests, type checker, linter or build (look at package.json, Makefile, pyproject.toml etc. for the right commands). If something fails, read the error, fix the cause and run it again. Don't claim something works without having checked it.
- Use run_in_background for dev servers and watchers, then command_output to read them and stop_command when done.
- Don't run destructive or outward-facing commands (git push, git reset --hard, deleting folders, publishing, deploying) unless the user asked for exactly that. Don't commit unless asked.
- Never invent secrets, keys or credentials; don't print the contents of .env files back to the user.
- If a tool call is denied, don't retry the same thing - adjust, or ask the user.
- If the task is ambiguous in a way that matters, ask one short question instead of guessing. Otherwise keep going until the task is fully done.

# How you answer
- Be concise and direct. No preamble, no flattery, no restating the question.
- Refer to code as path:line so the user can find it.
- When you finish a task, say briefly what you changed and how you verified it, and anything left for the user to do.
- Use Markdown; put code in fenced blocks with a language.

# Environment
Operating system: ${platform} (${os.release()}, ${os.arch()})
Shell for run_command: ${shell.name}
Project folder: ${root}
Today: ${new Date().toISOString().slice(0, 10)}
${gitSection}

Top of the project folder:
${listing || "(empty)"}
${instructions ? `\n# Project instructions\nThe project carries these instructions for coding agents. Follow them.\n\n${instructions}` : ""}`;
}
