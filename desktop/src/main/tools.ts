import { promises as fs } from "node:fs";
import path from "node:path";

import type { TodoItem } from "../shared/types.ts";
import { countChanges, lineDiff } from "./diff.ts";
import { glob, grep, looksBinary, relativePosix, resolveInside } from "./files.ts";
import { NETWORK_HINT, planSandbox } from "./sandbox.ts";
import { webSearch } from "./search.ts";
import type { ToolSchema } from "./models.ts";
import {
  capOutput,
  readBackground,
  runCommand,
  startBackground,
  stopBackground,
} from "./shell.ts";

// ==========================================
// THE CODING TOOLS
// ==========================================
//
// Each tool first *plans* - checks its arguments and
// works out exactly what it would do - and only then,
// once allowed, *applies*. So a bad edit (text not
// found, file never read) is turned back to the model
// at once, and what the person approves is exactly
// what happens.
//

export type ToolKind = "read" | "edit" | "command" | "network" | "meta" | "task" | "mcp";

export type ToolContext = {
  root: string;
  signal: AbortSignal;
  // Files the model has read, with their modified
  // time then - an edit to a file it never read, or
  // one that changed since, is refused.
  readFiles: Map<string, number>;
  backgroundIds: string[];
  onOutput: (text: string) => void;
  setTodos: (todos: TodoItem[]) => void;
  // Whether commands run sandboxed, and whether that
  // sandbox is enforced by the OS.
  sandbox: { enabled: boolean; strong: boolean };
  // Called with a file's path just before it is written,
  // so its old content can be kept for undo.
  beforeWrite: (file: string) => Promise<void>;
  // Starts a read-only helper agent (see subagent.ts).
  runSubagent?: (description: string, prompt: string, onStep: (steps: number, label: string) => void) => Promise<string>;
};

export type ToolResult = {
  output: string;
  error?: boolean;
  diff?: string;
  // Shorter text for the transcript, if different.
  display?: string;
};

export type ToolPlan =
  | { error: string }
  | {
      title: string;
      detail?: string;
      detailKind?: "diff" | "command" | "text";
      commandPrefix?: string;
      // A command that should be confirmed whatever
      // the mode (git push, rm -rf, sudo...).
      dangerous?: boolean;
      // A command safe enough to never ask about.
      readOnly?: boolean;
      // A command that will run inside the sandbox.
      sandboxed?: boolean;
      // A command that asked for the network, so runs
      // outside the sandbox.
      network?: boolean;
      apply: () => Promise<ToolResult>;
    };

export type Tool = {
  schema: ToolSchema;
  kind: ToolKind;
  summary: (args: Record<string, unknown>) => string;
  plan: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolPlan>;
};

const str = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

async function mtime(file: string) {
  try {
    return (await fs.stat(file)).mtimeMs;
  } catch {
    return null;
  }
}

function numbered(lines: string[], from: number) {
  return lines
    .map((line, index) => {
      const text = line.length > 2000 ? `${line.slice(0, 2000)}... [line cut]` : line;
      return `${String(from + index).padStart(5)}\t${text}`;
    })
    .join("\n");
}

// ------------------------------------------
// COMMAND SAFETY
// ------------------------------------------

const READ_ONLY = [
  /^git (status|diff|log|show|branch|remote -v|rev-parse|ls-files|blame)\b/,
  /^(ls|dir|pwd|whoami|date)\b/,
  /^(node|npm|npx|pnpm|yarn|python|python3|pip|go|cargo|rustc|java|dotnet|deno|bun) (-v|--version|-V|version)$/,
  /^(Get-ChildItem|Get-Location|Get-Content)\b/i,
  /^cat\s+[\w./\\-]+$/,
];

const SHELL_SYNTAX = /[;&|><`$]|\$\(/;

export function isReadOnlyCommand(command: string) {
  const trimmed = command.trim();
  if (SHELL_SYNTAX.test(trimmed)) return false;
  return READ_ONLY.some((pattern) => pattern.test(trimmed));
}

const DANGEROUS = [
  /\bgit\s+push\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-\w*f/,
  /\bgit\s+checkout\s+--?\s*\.(\s|$)/,
  /\bgit\s+branch\s+-D\b/,
  /\brm\s+-\w*r\w*\s+(\/|~|\*|\.\.?(\s|$))/,
  /\bRemove-Item\b[^\n]*-Recurse/i,
  /\b(rd|rmdir)\s+\/s\b/i,
  /\bsudo\b/,
  /\bmkfs|\bdd\s+if=|\bformat\s+[a-z]:/i,
  /\b(shutdown|reboot|halt)\b/,
  /\bnpm\s+publish\b/,
  /curl[^|]*\|\s*(sh|bash)|iwr[^|]*\|\s*iex/i,
];

export function isDangerousCommand(command: string) {
  return DANGEROUS.some((pattern) => pattern.test(command));
}

// "npm run test -- --watch" -> "npm run test".
export function commandPrefix(command: string) {
  const words = command.trim().split(/\s+/);
  const kept: string[] = [];

  for (const word of words) {
    if (kept.length >= 3 || word.startsWith("-") || SHELL_SYNTAX.test(word)) break;
    kept.push(word);
  }

  return kept.join(" ") || words[0] || command;
}

// ------------------------------------------
// HTML TO TEXT, FOR fetch_url
// ------------------------------------------

function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<(br|\/p|\/div|\/h\d|\/li|\/tr|\/pre)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

// ------------------------------------------
// THE TOOLS
// ------------------------------------------

export const TOOLS: Tool[] = [
  {
    kind: "read",
    schema: {
      name: "list_directory",
      description:
        "List the files and folders in a directory of the project (one level). Use glob to find files by pattern across the whole project.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory, relative to the project root. Defaults to the root." },
        },
      },
    },
    summary: (args) => `List ${str(args.path) || "."}`,
    plan: async (args, context) => {
      let dir: string;
      try {
        dir = resolveInside(context.root, str(args.path) || ".");
      } catch (error) {
        return { error: (error as Error).message };
      }

      return {
        title: `List ${relativePosix(context.root, dir)}`,
        apply: async () => {
          const entries = await fs.readdir(dir, { withFileTypes: true });

          const lines = entries
            .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
            .slice(0, 500)
            .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));

          const more = entries.length > 500 ? `\n... and ${entries.length - 500} more` : "";

          return { output: lines.length ? lines.join("\n") + more : "(empty directory)" };
        },
      };
    },
  },

  {
    kind: "read",
    schema: {
      name: "read_file",
      description:
        "Read a text file, with line numbers. Reads up to 2000 lines; use offset and limit for longer files. Always read a file before editing it.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path, relative to the project root." },
          offset: { type: "number", description: "Line to start from (1-based). Optional." },
          limit: { type: "number", description: "How many lines to read. Optional, default 2000." },
        },
        required: ["path"],
      },
    },
    summary: (args) => `Read ${str(args.path)}`,
    plan: async (args, context) => {
      let file: string;
      try {
        file = resolveInside(context.root, str(args.path));
      } catch (error) {
        return { error: (error as Error).message };
      }

      return {
        title: `Read ${relativePosix(context.root, file)}`,
        apply: async () => {
          let buffer: Buffer;

          try {
            const stat = await fs.stat(file);
            if (stat.isDirectory()) {
              return { output: `${str(args.path)} is a directory. Use list_directory.`, error: true };
            }
            if (stat.size > 20 * 1024 * 1024) {
              return { output: `The file is ${Math.round(stat.size / 1024 / 1024)} MB - too big to read whole. Use grep to find what you need.`, error: true };
            }
            buffer = await fs.readFile(file);
          } catch {
            return { output: `No file at ${str(args.path)}. Use glob to find it.`, error: true };
          }

          if (looksBinary(buffer)) {
            return { output: `${str(args.path)} is a binary file (${buffer.length} bytes); it can't be read as text.`, error: true };
          }

          const all = buffer.toString("utf8").split(/\r?\n/);

          // A final newline ends the last line; it isn't a
          // line of its own.
          if (all.length > 1 && all[all.length - 1] === "") all.pop();

          const offset = Math.max(1, Math.floor(num(args.offset, 1)));
          const limit = Math.max(1, Math.floor(num(args.limit, 2000)));
          const slice = all.slice(offset - 1, offset - 1 + limit);

          context.readFiles.set(file, (await mtime(file)) ?? 0);

          if (all.length === 1 && all[0] === "") {
            return { output: "(the file is empty)", display: "empty file" };
          }

          const rest = all.length - (offset - 1 + slice.length);
          const note = rest > 0 ? `\n\n[${rest} more lines - read on with offset ${offset + slice.length}]` : "";

          return {
            output: numbered(slice, offset) + note,
            display: `${slice.length} lines`,
          };
        },
      };
    },
  },

  {
    kind: "read",
    schema: {
      name: "glob",
      description:
        'Find files by name pattern, newest first. "*.ts" matches at any depth; "src/**/*.tsx" within src. Respects .gitignore.',
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob pattern." },
          path: { type: "string", description: "Directory to search in. Optional." },
        },
        required: ["pattern"],
      },
    },
    summary: (args) => `Find ${str(args.pattern)}`,
    plan: async (args, context) => ({
      title: `Find ${str(args.pattern)}`,
      apply: async () => {
        try {
          const files = await glob(context.root, str(args.pattern), str(args.path) || ".");
          const shown = files.slice(0, 300);
          const more = files.length > 300 ? `\n... and ${files.length - 300} more (narrow the pattern)` : "";
          return {
            output: shown.length ? shown.join("\n") + more : "No files match.",
            display: `${files.length} file${files.length === 1 ? "" : "s"}`,
          };
        } catch (error) {
          return { output: (error as Error).message, error: true };
        }
      },
    }),
  },

  {
    kind: "read",
    schema: {
      name: "grep",
      description:
        "Search file contents with a regular expression (ripgrep syntax). Returns file:line: text. Respects .gitignore.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regular expression." },
          path: { type: "string", description: "Directory or file to search. Optional." },
          glob: { type: "string", description: 'Only files matching this glob, e.g. "*.py". Optional.' },
          ignore_case: { type: "boolean", description: "Case-insensitive. Optional." },
        },
        required: ["pattern"],
      },
    },
    summary: (args) => `Search for ${str(args.pattern)}`,
    plan: async (args, context) => ({
      title: `Search for ${str(args.pattern)}`,
      apply: async () => {
        try {
          const { matches, truncated } = await grep(context.root, {
            pattern: str(args.pattern),
            under: str(args.path) || ".",
            glob: str(args.glob) || undefined,
            ignoreCase: args.ignore_case === true,
          });

          if (!matches.length) return { output: "No matches.", display: "no matches" };

          const lines = matches.map((match) => `${match.file}:${match.line}: ${match.text}`);
          return {
            output: lines.join("\n") + (truncated ? "\n... [more matches - narrow the search]" : ""),
            display: `${matches.length}${truncated ? "+" : ""} matches`,
          };
        } catch (error) {
          return { output: (error as Error).message, error: true };
        }
      },
    }),
  },

  {
    kind: "edit",
    schema: {
      name: "edit_file",
      description:
        "Replace exact text in a file. old_string must match the file exactly (including indentation) and be unique, unless replace_all is true. Read the file first. Prefer this over write_file for changes to existing files.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path, relative to the project root." },
          old_string: { type: "string", description: "The exact text to replace." },
          new_string: { type: "string", description: "The text to put in its place." },
          replace_all: { type: "boolean", description: "Replace every occurrence. Optional." },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
    summary: (args) => `Edit ${str(args.path)}`,
    plan: async (args, context) => {
      let file: string;
      try {
        file = resolveInside(context.root, str(args.path));
      } catch (error) {
        return { error: (error as Error).message };
      }

      const rel = relativePosix(context.root, file);
      const current = await mtime(file);

      if (current === null) {
        return { error: `No file at ${rel}. Use write_file to create it.` };
      }

      const seen = context.readFiles.get(file);

      if (seen === undefined) {
        return { error: `Read ${rel} with read_file before editing it.` };
      }

      if (seen !== current) {
        return { error: `${rel} changed since you read it. Read it again, then edit.` };
      }

      const content = await fs.readFile(file, "utf8");
      const eol = content.includes("\r\n") ? "\r\n" : "\n";
      const fix = (text: string) => text.replace(/\r?\n/g, eol);

      const oldText = fix(str(args.old_string));
      const newText = fix(str(args.new_string));

      if (!oldText) {
        return { error: "old_string is empty. To add text, include a nearby line in old_string and repeat it in new_string." };
      }

      if (oldText === newText) {
        return { error: "old_string and new_string are the same - nothing would change." };
      }

      const count = content.split(oldText).length - 1;

      if (count === 0) {
        return {
          error: `old_string was not found in ${rel}. It must match exactly, including whitespace and indentation. Read the file again and copy the text.`,
        };
      }

      if (count > 1 && args.replace_all !== true) {
        return {
          error: `old_string appears ${count} times in ${rel}. Include more surrounding lines to make it unique, or set replace_all.`,
        };
      }

      const updated =
        args.replace_all === true ? content.split(oldText).join(newText) : content.replace(oldText, () => newText);

      const diff = lineDiff(content, updated, rel);
      const { added, removed } = countChanges(diff);

      return {
        title: `Edit ${rel}`,
        detail: diff,
        detailKind: "diff",
        apply: async () => {
          await context.beforeWrite(file);
          await fs.writeFile(file, updated, "utf8");
          context.readFiles.set(file, (await mtime(file)) ?? 0);

          // Show the model the edited region, so it can
          // check its own work without re-reading.
          const at = updated.indexOf(newText);
          const lineNo = updated.slice(0, Math.max(0, at)).split(/\r?\n/).length;
          const lines = updated.split(/\r?\n/);
          const from = Math.max(1, lineNo - 3);
          const span = newText.split(/\r?\n/).length + 6;
          const snippet = numbered(lines.slice(from - 1, from - 1 + Math.min(span, 60)), from);

          return {
            output: `Edited ${rel}${count > 1 ? ` (${count} places)` : ""}.\n${snippet}`,
            display: `+${added} -${removed}`,
            diff,
          };
        },
      };
    },
  },

  {
    kind: "edit",
    schema: {
      name: "write_file",
      description:
        "Create a file, or replace a whole file. Creates folders as needed. An existing file must be read first. For changing part of a file, use edit_file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path, relative to the project root." },
          content: { type: "string", description: "The complete file content." },
        },
        required: ["path", "content"],
      },
    },
    summary: (args) => `Write ${str(args.path)}`,
    plan: async (args, context) => {
      let file: string;
      try {
        file = resolveInside(context.root, str(args.path));
      } catch (error) {
        return { error: (error as Error).message };
      }

      const rel = relativePosix(context.root, file);
      const current = await mtime(file);
      const content = str(args.content);

      let before = "";

      if (current !== null) {
        const seen = context.readFiles.get(file);

        if (seen === undefined) {
          return { error: `${rel} already exists. Read it with read_file before replacing it (or use edit_file).` };
        }

        if (seen !== current) {
          return { error: `${rel} changed since you read it. Read it again first.` };
        }

        before = await fs.readFile(file, "utf8");
      }

      const diff = current === null
        ? `+++ ${rel} (new file)\n${content.split(/\r?\n/).slice(0, 400).map((line) => `+${line}`).join("\n")}`
        : lineDiff(before, content, rel);

      const lineCount = content.split(/\r?\n/).length;

      return {
        title: current === null ? `Create ${rel}` : `Rewrite ${rel}`,
        detail: diff,
        detailKind: "diff",
        apply: async () => {
          await context.beforeWrite(file);
          await fs.mkdir(path.dirname(file), { recursive: true });
          await fs.writeFile(file, content, "utf8");
          context.readFiles.set(file, (await mtime(file)) ?? 0);

          return {
            output: current === null ? `Created ${rel} (${lineCount} lines).` : `Rewrote ${rel} (${lineCount} lines).`,
            display: current === null ? `new, ${lineCount} lines` : `${lineCount} lines`,
            diff,
          };
        },
      };
    },
  },

  {
    kind: "command",
    schema: {
      name: "run_command",
      description:
        "Run a shell command in the project folder: tests, builds, linters, git, package managers. Returns combined output and the exit code. Commands run in a sandbox with no network access; set needs_network only when the command must reach the internet (installing packages, git fetch/pull/push, downloads) - the user is asked first. For servers or watchers that keep running, set run_in_background, then use command_output and stop_command. Never run interactive commands (they would hang).",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The command line." },
          timeout_seconds: { type: "number", description: "Give up after this long. Optional, default 120, max 600." },
          run_in_background: { type: "boolean", description: "Start it and return at once with an id. Optional." },
          needs_network: { type: "boolean", description: "Run outside the sandbox, with internet access. Only when needed. Optional." },
        },
        required: ["command"],
      },
    },
    summary: (args) => `Run ${str(args.command)}`,
    plan: async (args, context) => {
      const command = str(args.command).trim();

      if (!command) {
        return { error: "command is empty." };
      }

      const inBackground = args.run_in_background === true;
      const network = args.needs_network === true;
      const sandboxed = context.sandbox.enabled && !network;

      return {
        title: `${inBackground ? "Start in background" : "Run"}: ${command}`,
        detail: command,
        detailKind: "command",
        commandPrefix: commandPrefix(command),
        dangerous: isDangerousCommand(command),
        readOnly: !inBackground && !network && isReadOnlyCommand(command),
        sandboxed,
        network: network && context.sandbox.enabled,
        apply: async () => {
          const runAs = sandboxed ? await planSandbox(command, context.root) : undefined;

          if (inBackground) {
            const id = startBackground(command, context.root, runAs);
            context.backgroundIds.push(id);

            // A moment for it to print its first lines
            // (a port, an error).
            await new Promise((resolve) => setTimeout(resolve, 4000));
            const first = readBackground(id);

            return {
              output: `Started in the background as ${id}.${first?.running ? "" : ` It already exited (code ${first?.exitCode}).`}\n${first?.output || "(no output yet)"}`,
              display: `background ${id}`,
            };
          }

          const timeout = Math.min(600, Math.max(5, num(args.timeout_seconds, 120))) * 1000;

          const result = await runCommand({
            command,
            runAs,
            cwd: context.root,
            timeoutMs: timeout,
            signal: context.signal,
            onOutput: context.onOutput,
          });

          const status = result.stopped
            ? "Stopped by the person."
            : result.timedOut
              ? `Timed out after ${timeout / 1000}s and was stopped. For something long-running, use run_in_background.`
              : `Exit code ${result.exitCode}.`;

          // A sandboxed command that failed the way an
          // offline one does is told how to ask for the
          // network.
          const offline =
            sandboxed &&
            result.exitCode !== 0 &&
            /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|getaddrinfo|127\.0\.0\.1(:| port )9\b|Could not resolve host|Couldn.t connect|Failed to connect|network|offline|Operation not permitted|proxy/i.test(result.output);

          return {
            output: `${result.output.trim() || "(no output)"}\n\n${status}${offline ? `\n\n${NETWORK_HINT}` : ""}`,
            error: result.exitCode !== 0,
            display: result.timedOut ? "timed out" : `exit ${result.exitCode}`,
          };
        },
      };
    },
  },

  {
    kind: "meta",
    schema: {
      name: "command_output",
      description: "Read new output from a background command started with run_in_background, and whether it is still running.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: 'The id, e.g. "bg1".' } },
        required: ["id"],
      },
    },
    summary: (args) => `Output of ${str(args.id)}`,
    plan: async (args) => ({
      title: `Output of ${str(args.id)}`,
      apply: async () => {
        const result = readBackground(str(args.id));
        if (!result) return { output: `No background command ${str(args.id)}.`, error: true };
        return {
          output: `${result.running ? "Still running." : `Exited with code ${result.exitCode}.`}\n${result.output || "(no new output)"}`,
        };
      },
    }),
  },

  {
    kind: "meta",
    schema: {
      name: "stop_command",
      description: "Stop a background command.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    summary: (args) => `Stop ${str(args.id)}`,
    plan: async (args) => ({
      title: `Stop ${str(args.id)}`,
      apply: async () =>
        stopBackground(str(args.id))
          ? { output: `Stopped ${str(args.id)}.` }
          : { output: `No background command ${str(args.id)}.`, error: true },
    }),
  },

  {
    kind: "network",
    schema: {
      name: "fetch_url",
      description:
        "Fetch a web page or raw file (documentation, an API reference, a GitHub raw file) and return it as text.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "An http(s) URL." } },
        required: ["url"],
      },
    },
    summary: (args) => `Fetch ${str(args.url)}`,
    plan: async (args, context) => {
      let url: URL;

      try {
        url = new URL(str(args.url));
        if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
      } catch {
        return { error: "Give a full http(s) URL." };
      }

      return {
        title: `Fetch ${url.href}`,
        detail: url.href,
        detailKind: "text",
        apply: async () => {
          try {
            const response = await fetch(url, {
              headers: { "User-Agent": "Mozilla/5.0 (Teamski desktop)" },
              signal: AbortSignal.any([context.signal, AbortSignal.timeout(20000)]),
              redirect: "follow",
            });

            const type = response.headers.get("content-type") ?? "";
            const raw = (await response.text()).slice(0, 3_000_000);
            const text = /html/i.test(type) ? htmlToText(raw) : raw;

            return {
              output: `${response.status} ${url.href}\n\n${capOutput(text).slice(0, 40_000)}`,
              error: !response.ok,
              display: `${response.status}, ${Math.round(text.length / 1000)}k chars`,
            };
          } catch (error) {
            return { output: `Couldn't fetch ${url.href}: ${(error as Error).message}`, error: true };
          }
        },
      };
    },
  },

  {
    kind: "read",
    schema: {
      name: "web_search",
      description:
        "Search the web (DuckDuckGo). Returns titles, URLs and snippets. Use it for documentation, error messages and library versions; then fetch_url a result to read it.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "What to search for." } },
        required: ["query"],
      },
    },
    summary: (args) => `Search the web for ${str(args.query)}`,
    plan: async (args, context) => {
      const query = str(args.query).trim();
      if (!query) return { error: "query is empty." };

      return {
        title: `Search the web for ${query}`,
        apply: async () => {
          try {
            const results = (await webSearch(query, context.signal)).slice(0, 8);

            if (!results.length) return { output: "No results.", display: "no results" };

            return {
              output: results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n"),
              display: `${results.length} results`,
            };
          } catch (error) {
            return { output: `Search failed: ${(error as Error).message}`, error: true };
          }
        },
      };
    },
  },

  {
    kind: "task",
    schema: {
      name: "task",
      description:
        "Hand a self-contained research job to a helper agent that can only read (list, read, glob, grep, web search) and get back a short report with file paths and line numbers. Use it for broad searches that would otherwise fill your context, e.g. finding every place the session cookie is read. Start several in the same step to run them in parallel. The helper sees nothing of this conversation, so put everything it needs in the prompt.",
      parameters: {
        type: "object",
        properties: {
          description: { type: "string", description: "A 3-6 word label, e.g. Find session cookie reads." },
          prompt: { type: "string", description: "The full job, with the context the helper needs." },
        },
        required: ["description", "prompt"],
      },
    },
    summary: (args) => `Helper: ${str(args.description) || "research"}`,
    plan: async (args, context) => {
      const prompt = str(args.prompt).trim();
      if (!prompt) return { error: "prompt is empty." };
      if (!context.runSubagent) return { error: "Helpers can't start helpers." };

      const description = str(args.description).trim() || "research";

      return {
        title: `Helper: ${description}`,
        apply: async () => {
          let steps = 0;

          const report = await context.runSubagent!(description, prompt, (n, label) => {
            steps = n;
            context.onOutput(`${label}\n`);
          });

          return { output: report, display: `${steps} steps` };
        },
      };
    },
  },

  {
    kind: "meta",
    schema: {
      name: "todo_write",
      description:
        "Keep a visible task list for multi-step work. Send the whole list every time. Exactly one task should be in_progress while you work; mark tasks completed as soon as they are done.",
      parameters: {
        type: "object",
        properties: {
          todos: {
            type: "array",
            items: {
              type: "object",
              properties: {
                content: { type: "string" },
                status: { type: "string", enum: ["pending", "in_progress", "completed"] },
              },
              required: ["content", "status"],
            },
          },
        },
        required: ["todos"],
      },
    },
    summary: () => "Update tasks",
    plan: async (args, context) => ({
      title: "Update tasks",
      apply: async () => {
        const todos = (Array.isArray(args.todos) ? args.todos : [])
          .map((item) => {
            const entry = (item ?? {}) as Record<string, unknown>;
            const status = str(entry.status);
            return {
              content: str(entry.content),
              status: (["pending", "in_progress", "completed"].includes(status) ? status : "pending") as TodoItem["status"],
            };
          })
          .filter((item) => item.content);

        context.setTodos(todos);

        const done = todos.filter((todo) => todo.status === "completed").length;
        return { output: `Task list updated (${done}/${todos.length} done).`, display: `${done}/${todos.length} done` };
      },
    }),
  },
];

export function toolByName(name: string) {
  return TOOLS.find((tool) => tool.schema.name === name);
}

export const TOOL_SCHEMAS = TOOLS.map((tool) => tool.schema);
