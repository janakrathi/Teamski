import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// ==========================================
// THE COMMAND SANDBOX
// ==========================================
//
// Commands the agent runs go through a sandbox unless
// the person turned it off or approved a command that
// needs the network.
//
// macOS: Anthropic's sandbox-runtime (Apache-2.0, the
// one Claude Code uses) - a Seatbelt profile from the
// OS: no network at all, writes only to the project
// folder, temp and package caches, and no reading of
// ~/.ssh and other secrets. Enforced by the kernel.
//
// Windows: there is no OS sandbox without an admin
// setup, so - like Codex's no-admin mode - the network
// is cut by pointing every proxy setting at a dead
// port, stubbing git-over-ssh and putting npm and pip
// offline. Ordinary tools obey that; a program that
// opens sockets itself can still get out, and writes
// are not confined. It is labelled "best effort", and
// commands still ask unless the mode is full auto.
//

export type SandboxPlan = {
  // What to spawn instead of the plain command.
  command: string;
  // Spawn with /bin/sh -c (the wrapper is a sh string).
  useSh: boolean;
  env: Record<string, string>;
  // OS-enforced: network and writes are really blocked.
  strong: boolean;
};

export type SandboxStatus = {
  available: boolean;
  strong: boolean;
  detail: string;
};

// A dead endpoint: nothing listens on the discard port.
const DEAD_PROXY = "http://127.0.0.1:9";

function weakNetworkEnv(): Record<string, string> {
  const env: Record<string, string> = {
    HTTP_PROXY: DEAD_PROXY,
    HTTPS_PROXY: DEAD_PROXY,
    ALL_PROXY: DEAD_PROXY,
    http_proxy: DEAD_PROXY,
    https_proxy: DEAD_PROXY,
    all_proxy: DEAD_PROXY,
    NO_PROXY: "",
    no_proxy: "",
    npm_config_proxy: DEAD_PROXY,
    npm_config_https_proxy: DEAD_PROXY,
    npm_config_offline: "true",
    PIP_NO_INDEX: "1",
    PIP_PROXY: DEAD_PROXY,
    YARN_ENABLE_NETWORK: "0",
    GIT_SSH_COMMAND: process.platform === "win32"
      ? "cmd /c echo Network is off in the Teamski sandbox 1>&2 && exit 1"
      : "sh -c 'echo Network is off in the Teamski sandbox >&2; exit 1'",
    TEAMSKI_SANDBOX: "network-off",
  };

  return env;
}

// ------------------------------------------
// macOS: sandbox-runtime
// ------------------------------------------

type Runtime = {
  SandboxManager: {
    initialize(config: unknown): Promise<void>;
    wrapWithSandbox(command: string, binShell?: string, customConfig?: unknown): Promise<string>;
    isSupportedPlatform(): boolean;
    reset(): Promise<void>;
  };
};

let runtime: Promise<Runtime | null> | null = null;
let runtimeError = "";

// The package is ESM, so it is loaded from node_modules
// at run time rather than bundled. On macOS it runs the
// system's sandbox-exec, so nothing of it needs to sit
// outside the app archive.
function resolveModule(name: string) {
  const require = createRequire(__filename);
  return require.resolve(name);
}

function configFor(root: string) {
  const home = os.homedir();

  return {
    network: {
      allowedDomains: [] as string[],
      deniedDomains: [] as string[],
      allowLocalBinding: true,
    },
    filesystem: {
      denyRead: [
        path.join(home, ".ssh"),
        path.join(home, ".aws"),
        path.join(home, ".gnupg"),
        path.join(home, ".config", "gcloud"),
        path.join(home, "Library", "Keychains"),
      ],
      allowRead: [] as string[],
      allowWrite: [
        root,
        os.tmpdir(),
        "/tmp",
        "/private/tmp",
        path.join(home, ".npm"),
        path.join(home, ".cache"),
        path.join(home, "Library", "Caches"),
        path.join(home, ".pnpm-store"),
        path.join(home, ".yarn"),
        path.join(home, ".cargo", "registry"),
        path.join(home, "go", "pkg"),
      ],
      denyWrite: [] as string[],
    },
  };
}

async function loadRuntime(root: string): Promise<Runtime | null> {
  if (process.platform !== "darwin") return null;

  if (!runtime) {
    runtime = (async () => {
      try {
        const entry = resolveModule("@anthropic-ai/sandbox-runtime");
        const loaded = (await import(pathToFileURL(entry).href)) as Runtime;

        if (!loaded.SandboxManager.isSupportedPlatform()) {
          runtimeError = "this version of macOS isn't supported";
          return null;
        }

        await loaded.SandboxManager.initialize(configFor(root));
        return loaded;
      } catch (error) {
        runtimeError = (error as Error).message.slice(0, 200);
        return null;
      }
    })();
  }

  return runtime;
}

// ------------------------------------------
// THE API
// ------------------------------------------

export async function sandboxStatus(root = os.tmpdir()): Promise<SandboxStatus> {
  if (process.platform === "darwin") {
    const loaded = await loadRuntime(root);

    return loaded
      ? { available: true, strong: true, detail: "macOS sandbox: no network, writes only inside the project (plus temp and package caches), no access to ~/.ssh and other secrets." }
      : { available: true, strong: false, detail: `The macOS sandbox couldn't start (${runtimeError || "unknown reason"}), so only the network is blocked, best effort.` };
  }

  return {
    available: true,
    strong: false,
    detail: "Best effort on Windows: network is blocked through proxy settings, which ordinary tools respect. Writes aren't confined, so commands still ask unless you choose Full auto.",
  };
}

export async function planSandbox(command: string, root: string): Promise<SandboxPlan> {
  if (process.platform === "darwin") {
    const loaded = await loadRuntime(root);

    if (loaded) {
      try {
        const shell = process.env.SHELL && /zsh|bash/.test(process.env.SHELL) ? process.env.SHELL : "/bin/zsh";
        const wrapped = await loaded.SandboxManager.wrapWithSandbox(command, shell, configFor(root));
        return { command: wrapped, useSh: true, env: { TEAMSKI_SANDBOX: "on" }, strong: true };
      } catch (error) {
        runtimeError = (error as Error).message.slice(0, 200);
      }
    }
  }

  return { command, useSh: false, env: weakNetworkEnv(), strong: false };
}

// Plain-language hint for the model when a sandboxed
// command fails for want of the network.
export const NETWORK_HINT =
  "Commands run in a sandbox with no network access. If this failed because it needed the network (installing packages, git fetch/pull/push, downloading), run it again with needs_network: true - the user will be asked.";
