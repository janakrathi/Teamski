import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";

// ==========================================
// RUNNING COMMANDS
// ==========================================
//
// The agent's hands on the person's machine: tests,
// builds, git, package managers. On Windows the shell
// is PowerShell 7 when it is installed (it understands
// "&&"), else Windows PowerShell; on a Mac the
// person's own login shell, so their PATH (node, git,
// python) is what the agent sees.
//
// Output is capped: the head and tail of a long log
// are what explain it.
//

export type ShellInfo = { name: string; file: string; args: (command: string) => string[] };

let cached: ShellInfo | null = null;

// PowerShell's own exit code is 1 or 0, whatever the
// program it ran returned. Hand the real one back, so
// "exit 2" from a hook or a test runner's code survive.
function withExitCode(command: string) {
  return `${command}
$__ok = $?; $__code = $global:LASTEXITCODE; if ($__code) { exit $__code } elseif (-not $__ok) { exit 1 } else { exit 0 }`;
}

export function detectShell(): ShellInfo {
  if (cached) return cached;

  if (process.platform === "win32") {
    const pwsh = spawnSync("pwsh.exe", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], {
      windowsHide: true,
      timeout: 8000,
      encoding: "utf8",
    });

    if (pwsh.status === 0) {
      cached = {
        name: "PowerShell 7 (pwsh)",
        file: "pwsh.exe",
        args: (command) => ["-NoProfile", "-NonInteractive", "-Command", withExitCode(command)],
      };
    } else {
      cached = {
        name: "Windows PowerShell 5.1 (no && or ||; use ; and if ($?) { ... })",
        file: "powershell.exe",
        args: (command) => ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", withExitCode(command)],
      };
    }

    return cached;
  }

  const user = process.env.SHELL;
  const file = user && existsSync(user) ? user : existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/bash";

  cached = {
    name: file.split("/").pop() ?? "sh",
    file,
    args: (command) => ["-l", "-c", command],
  };

  return cached;
}

// Apps opened from the Dock or Finder get a bare PATH.
// Ask the login shell for the real one, once.
export function adoptLoginPath() {
  if (process.platform === "win32") return;

  const shell = detectShell();

  const result = spawnSync(shell.file, ["-ilc", 'printf "__PATH__%s__PATH__" "$PATH"'], {
    encoding: "utf8",
    timeout: 8000,
  });

  const match = /__PATH__(.*)__PATH__/.exec(result.stdout ?? "");

  if (match?.[1]) {
    process.env.PATH = match[1];
  }
}

function killTree(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) return;

  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    } else {
      process.kill(-child.pid, "SIGTERM");
      setTimeout(() => {
        try {
          if (child.pid) process.kill(-child.pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }, 2000);
    }
  } catch {
    // Already gone.
  }
}

const HEAD = 12_000;
const TAIL = 18_000;

export function capOutput(text: string) {
  if (text.length <= HEAD + TAIL) return text;

  const dropped = text.length - HEAD - TAIL;
  return `${text.slice(0, HEAD)}\n\n... [${dropped} characters cut from the middle] ...\n\n${text.slice(-TAIL)}`;
}

// How to run one command: plain, or wrapped by the
// sandbox (see sandbox.ts).
export type RunAs = {
  command: string;
  useSh?: boolean;
  env?: Record<string, string>;
};

function start(run: RunAs, cwd: string) {
  const shell = detectShell();
  const file = run.useSh ? "/bin/sh" : shell.file;
  const args = run.useSh ? ["-c", run.command] : shell.args(run.command);

  return spawn(file, args, {
    cwd,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", CI: process.env.CI ?? "", TERM: "dumb", GIT_PAGER: "cat", PAGER: "cat", ...(run.env ?? {}) },
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// Strip terminal colour codes a tool printed anyway.
function plain(text: string) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r(?!\n)/g, "\n");
}

export async function runCommand(options: {
  command: string;
  runAs?: RunAs;
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
}): Promise<{ output: string; exitCode: number | null; timedOut: boolean; stopped: boolean }> {
  return new Promise((resolve) => {
    const child = start(options.runAs ?? { command: options.command }, options.cwd);
    let output = "";
    let timedOut = false;
    let stopped = false;

    const take = (data: Buffer) => {
      const text = plain(data.toString("utf8"));
      output += text;

      // Keep memory bounded on a chatty command.
      if (output.length > 2_000_000) {
        output = output.slice(0, HEAD) + "\n...\n" + output.slice(-1_000_000);
      }

      options.onOutput?.(text);
    };

    child.stdout?.on("data", take);
    child.stderr?.on("data", take);

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, options.timeoutMs);

    const onAbort = () => {
      stopped = true;
      killTree(child);
    };

    options.signal?.addEventListener("abort", onAbort, { once: true });

    const finish = (exitCode: number | null) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({ output: capOutput(output), exitCode, timedOut, stopped });
    };

    child.on("error", (error) => {
      output += `\n${error.message}`;
      finish(null);
    });

    child.on("close", (code) => finish(code));
  });
}

// ------------------------------------------
// BACKGROUND COMMANDS
// ------------------------------------------
//
// Dev servers and watchers never exit, so they run in
// the background: the agent starts one, reads its
// output when it wants, and stops it. All of a
// session's are stopped when the session ends.

type Background = {
  id: string;
  command: string;
  child: ChildProcess;
  output: string;
  readUpTo: number;
  exitCode: number | null;
  running: boolean;
};

const background = new Map<string, Background>();
let counter = 0;

export function startBackground(command: string, cwd: string, runAs?: RunAs) {
  const child = start(runAs ?? { command }, cwd);
  const id = `bg${++counter}`;

  const entry: Background = {
    id,
    command,
    child,
    output: "",
    readUpTo: 0,
    exitCode: null,
    running: true,
  };

  const take = (data: Buffer) => {
    entry.output += plain(data.toString("utf8"));

    if (entry.output.length > 1_000_000) {
      const cut = entry.output.length - 500_000;
      entry.output = entry.output.slice(cut);
      entry.readUpTo = Math.max(0, entry.readUpTo - cut);
    }
  };

  child.stdout?.on("data", take);
  child.stderr?.on("data", take);
  child.on("error", (error) => {
    entry.output += `\n${error.message}`;
    entry.running = false;
  });
  child.on("close", (code) => {
    entry.exitCode = code;
    entry.running = false;
  });

  background.set(id, entry);

  return id;
}

export function readBackground(id: string) {
  const entry = background.get(id);

  if (!entry) return null;

  const fresh = entry.output.slice(entry.readUpTo);
  entry.readUpTo = entry.output.length;

  return {
    command: entry.command,
    running: entry.running,
    exitCode: entry.exitCode,
    output: capOutput(fresh),
  };
}

export function stopBackground(id: string) {
  const entry = background.get(id);

  if (!entry) return false;

  killTree(entry.child);
  entry.running = false;
  return true;
}

export function stopAllBackground(ids?: string[]) {
  for (const [id, entry] of background) {
    if (!ids || ids.includes(id)) {
      killTree(entry.child);
      entry.running = false;
    }
  }
}
