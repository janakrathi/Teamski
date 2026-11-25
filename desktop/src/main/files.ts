import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

// ==========================================
// FILES IN THE PROJECT FOLDER
// ==========================================
//
// Every path the model names is untrusted: it has to
// resolve inside the folder the person opened. Listing
// goes through git when the folder is a repository, so
// .gitignore is respected for free; otherwise a walk
// that skips the usual heavy folders.
//

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".idea",
  ".vscode-test",
  ".turbo",
  ".cache",
  ".gradle",
  "Pods",
  "DerivedData",
]);

export class OutsideFolderError extends Error {}

export function resolveInside(root: string, given: string): string {
  const cleaned = (given ?? "").trim() || ".";

  const full = path.resolve(root, cleaned);

  const relative = path.relative(root, full);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new OutsideFolderError(
      `"${given}" is outside the project folder (${root}). Only files inside it can be used.`
    );
  }

  return full;
}

// "src\\app.ts" -> "src/app.ts", relative to the root.
export function relativePosix(root: string, full: string) {
  return path.relative(root, full).split(path.sep).join("/") || ".";
}

function run(command: string, args: string[], cwd: string, timeout = 15000) {
  return new Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }>(
    (resolve) => {
      execFile(
        command,
        args,
        { cwd, timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
        (error, stdout, stderr) => {
          const code = error && typeof (error as { code?: unknown }).code === "number"
            ? ((error as { code: number }).code)
            : error
              ? null
              : 0;

          resolve({ ok: !error, stdout: String(stdout), stderr: String(stderr), code });
        }
      );
    }
  );
}

export async function isGitRepo(root: string) {
  const result = await run("git", ["rev-parse", "--is-inside-work-tree"], root);
  return result.ok && result.stdout.trim() === "true";
}

// Every file under a directory, relative to the root,
// with forward slashes. Capped so a huge folder can't
// stall the agent.
export async function listFiles(root: string, under = ".", cap = 20000): Promise<string[]> {
  const start = resolveInside(root, under);

  if (await isGitRepo(root)) {
    const result = await run(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", relativePosix(root, start)],
      root
    );

    if (result.ok) {
      const files = result.stdout.split("\0").filter(Boolean);

      // ls-files lists deleted-but-tracked files too.
      const present: string[] = [];

      for (const file of files.slice(0, cap)) {
        try {
          await fs.access(path.join(root, file));
          present.push(file);
        } catch {
          // Deleted in the working tree.
        }
      }

      return present;
    }
  }

  const found: string[] = [];

  async function walk(dir: string) {
    if (found.length >= cap) return;

    let entries;

    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (found.length >= cap) return;

      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(full);
      } else if (entry.isFile()) {
        found.push(relativePosix(root, full));
      }
    }
  }

  await walk(start);

  return found;
}

// ------------------------------------------
// GLOB
// ------------------------------------------

export function globToRegExp(pattern: string): RegExp {
  let source = "";
  let i = 0;
  let braces = 0;

  // A pattern with no slash matches at any depth:
  // "*.ts" finds every TypeScript file.
  const normalised = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  const full = normalised.includes("/") ? normalised : `**/${normalised}`;

  while (i < full.length) {
    const char = full[i];

    if (char === "*") {
      if (full[i + 1] === "*") {
        if (full[i + 2] === "/") {
          source += "(?:.*/)?";
          i += 3;
        } else {
          source += ".*";
          i += 2;
        }
      } else {
        source += "[^/]*";
        i++;
      }
    } else if (char === "?") {
      source += "[^/]";
      i++;
    } else if (char === "{") {
      braces++;
      source += "(?:";
      i++;
    } else if (char === "}" && braces > 0) {
      braces--;
      source += ")";
      i++;
    } else if (char === "," && braces > 0) {
      source += "|";
      i++;
    } else {
      source += char.replace(/[.+^$()|[\]\\]/g, "\\$&");
      i++;
    }
  }

  return new RegExp(`^${source}$`, process.platform === "win32" || process.platform === "darwin" ? "i" : "");
}

export async function glob(root: string, pattern: string, under = ".") {
  const regex = globToRegExp(pattern);
  const base = relativePosix(root, resolveInside(root, under));
  const files = await listFiles(root, under);

  const matches = files.filter((file) => {
    const inner = base === "." ? file : file.startsWith(`${base}/`) ? file.slice(base.length + 1) : file;
    return regex.test(inner) || regex.test(file);
  });

  // Newest first: what was just touched is usually
  // what matters.
  const withTimes = await Promise.all(
    matches.slice(0, 2000).map(async (file) => {
      try {
        const stat = await fs.stat(path.join(root, file));
        return { file, time: stat.mtimeMs };
      } catch {
        return { file, time: 0 };
      }
    })
  );

  return withTimes.sort((a, b) => b.time - a.time).map((entry) => entry.file);
}

// ------------------------------------------
// GREP
// ------------------------------------------

export type GrepMatch = { file: string; line: number; text: string };

let ripgrep: boolean | null = null;

async function hasRipgrep(root: string) {
  if (ripgrep === null) {
    ripgrep = (await run("rg", ["--version"], root, 5000)).ok;
  }

  return ripgrep;
}

export async function grep(
  root: string,
  options: { pattern: string; under?: string; glob?: string; ignoreCase?: boolean; limit?: number }
): Promise<{ matches: GrepMatch[]; truncated: boolean }> {
  const limit = options.limit ?? 200;
  const start = resolveInside(root, options.under ?? ".");

  if (await hasRipgrep(root)) {
    const args = ["--line-number", "--no-heading", "--color", "never", "--max-columns", "300", "--max-columns-preview"];
    if (options.ignoreCase) args.push("-i");
    if (options.glob) args.push("--glob", options.glob);
    args.push("-e", options.pattern, "--", start);

    const result = await run("rg", args, root, 30000);

    // rg exits 1 for "no matches", 2 for a bad pattern.
    if (result.code === 2) {
      throw new Error(result.stderr.trim() || "Invalid search pattern.");
    }

    const matches: GrepMatch[] = [];

    for (const line of result.stdout.split(/\r?\n/)) {
      const match = /^(.*?):(\d+):(.*)$/.exec(line);
      if (!match) continue;

      // On Windows the path itself has a colon after the
      // drive letter; the lazy match then stops there.
      let file = match[1];
      let lineNo = match[2];
      let text = match[3];

      if (/^[A-Za-z]$/.test(file)) {
        const rest = /^(.*?):(\d+):(.*)$/.exec(line.slice(2));
        if (!rest) continue;
        file = line.slice(0, 2) + rest[1];
        lineNo = rest[2];
        text = rest[3];
      }

      matches.push({
        file: relativePosix(root, path.resolve(root, file)),
        line: Number(lineNo),
        text: text.trim(),
      });

      if (matches.length >= limit) {
        return { matches, truncated: true };
      }
    }

    return { matches, truncated: false };
  }

  // No ripgrep: a plain scan.
  let regex: RegExp;

  try {
    regex = new RegExp(options.pattern, options.ignoreCase ? "i" : "");
  } catch (error) {
    throw new Error(`Invalid search pattern: ${(error as Error).message}`);
  }

  const fileRegex = options.glob ? globToRegExp(options.glob) : null;
  const files = await listFiles(root, options.under ?? ".");
  const matches: GrepMatch[] = [];

  for (const file of files) {
    if (fileRegex && !fileRegex.test(file)) continue;

    const full = path.join(root, file);

    let content: string;

    try {
      const stat = await fs.stat(full);
      if (stat.size > 2 * 1024 * 1024) continue;
      const buffer = await fs.readFile(full);
      if (looksBinary(buffer)) continue;
      content = buffer.toString("utf8");
    } catch {
      continue;
    }

    const fileLines = content.split(/\r?\n/);

    for (let index = 0; index < fileLines.length; index++) {
      if (regex.test(fileLines[index])) {
        matches.push({ file, line: index + 1, text: fileLines[index].trim().slice(0, 300) });

        if (matches.length >= limit) {
          return { matches, truncated: true };
        }
      }
    }
  }

  return { matches, truncated: false };
}

export function looksBinary(buffer: Buffer) {
  const sample = buffer.subarray(0, 8000);
  return sample.includes(0);
}
