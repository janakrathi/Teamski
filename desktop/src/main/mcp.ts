import { existsSync, readFileSync } from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import type { McpServerState } from "../shared/types.ts";
import type { ToolSchema } from "./models.ts";

// ==========================================
// MCP SERVERS
// ==========================================
//
// The same config shape as Claude Code and Cursor, so
// people can paste what they already use:
//
//   { "mcpServers": {
//       "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"],
//                   "env": { "GITHUB_TOKEN": "..." } },
//       "linear": { "url": "https://mcp.linear.app/mcp", "headers": { "Authorization": "Bearer ..." } }
//   } }
//
// The file lives in the app's data folder, never in a
// project - a repo shouldn't be able to start programs
// on someone's machine by being opened.
//

type ServerConfig = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  disabled?: boolean;
};

type Connected = {
  name: string;
  client: Client | null;
  status: McpServerState["status"];
  error?: string;
  tools: { name: string; description?: string; inputSchema: Record<string, unknown> }[];
};

export const MCP_TEMPLATE = `{
  "mcpServers": {
  }
}
`;

function slug(text: string) {
  return text.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function mcpToolName(server: string, tool: string) {
  return `mcp__${slug(server)}__${slug(tool)}`.slice(0, 64);
}

export class McpHub {
  private file: string;
  private servers = new Map<string, Connected>();
  private loading: Promise<void> | null = null;

  constructor(file: string) {
    this.file = file;
  }

  private readConfig(): Record<string, ServerConfig> {
    if (!existsSync(this.file)) return {};

    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8"));
      return (parsed?.mcpServers ?? {}) as Record<string, ServerConfig>;
    } catch (error) {
      this.servers.set("(config)", {
        name: "mcp.json",
        client: null,
        status: "error",
        error: `mcp.json isn't valid JSON: ${(error as Error).message}`,
        tools: [],
      });
      return {};
    }
  }

  private async connect(name: string, config: ServerConfig): Promise<Connected> {
    if (config.disabled) return { name, client: null, status: "disabled", tools: [] };

    const client = new Client({ name: "teamski-desktop", version: "0.2.0" });

    try {
      if (config.url) {
        const transport = new StreamableHTTPClientTransport(new URL(config.url), {
          requestInit: { headers: config.headers ?? {} },
        });
        await withTimeout(client.connect(transport), 20000, "connecting");
      } else if (config.command) {
        const transport = new StdioClientTransport({
          command: config.command,
          args: config.args ?? [],
          env: { ...(process.env as Record<string, string>), ...(config.env ?? {}) },
          cwd: config.cwd,
          stderr: "ignore",
        });
        await withTimeout(client.connect(transport), 30000, "starting");
      } else {
        return { name, client: null, status: "error", error: 'Give either "command" or "url".', tools: [] };
      }

      const listed = await withTimeout(client.listTools(), 15000, "listing tools");

      return {
        name,
        client,
        status: "connected",
        tools: listed.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: (tool.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>,
        })),
      };
    } catch (error) {
      void client.close().catch(() => {});
      return { name, client: null, status: "error", error: (error as Error).message.slice(0, 300), tools: [] };
    }
  }

  // Connect every server in the file (once; reload()
  // starts over).
  ensure() {
    if (!this.loading) {
      this.loading = (async () => {
        const config = this.readConfig();
        const entries = Object.entries(config);

        for (const [name] of entries) {
          this.servers.set(name, { name, client: null, status: "connecting", tools: [] });
        }

        await Promise.all(
          entries.map(async ([name, server]) => {
            this.servers.set(name, await this.connect(name, server));
          })
        );
      })();
    }

    return this.loading;
  }

  async reload() {
    await this.close();
    this.servers.clear();
    this.loading = null;
    await this.ensure();
  }

  async close() {
    await Promise.all([...this.servers.values()].map((server) => server.client?.close().catch(() => {})));
  }

  states(): McpServerState[] {
    return [...this.servers.values()].map((server) => ({
      name: server.name,
      status: server.status,
      error: server.error,
      tools: server.tools.length,
    }));
  }

  schemas(): ToolSchema[] {
    const out: ToolSchema[] = [];

    for (const server of this.servers.values()) {
      if (server.status !== "connected") continue;

      for (const tool of server.tools) {
        out.push({
          name: mcpToolName(server.name, tool.name),
          description: `[${server.name}] ${tool.description ?? tool.name}`.slice(0, 1000),
          parameters: tool.inputSchema,
        });
      }
    }

    return out;
  }

  find(fullName: string) {
    for (const server of this.servers.values()) {
      for (const tool of server.tools) {
        if (mcpToolName(server.name, tool.name) === fullName) return { server, tool };
      }
    }

    return null;
  }

  async call(fullName: string, args: Record<string, unknown>, signal: AbortSignal) {
    const found = this.find(fullName);

    if (!found || !found.server.client) {
      return { text: `The MCP tool ${fullName} isn't available.`, error: true };
    }

    const result = await found.server.client.callTool(
      { name: found.tool.name, arguments: args },
      undefined,
      { signal, timeout: 120000 }
    );

    const parts: string[] = [];

    for (const item of (result.content ?? []) as { type: string; text?: string; resource?: { text?: string; uri?: string } }[]) {
      if (item.type === "text" && item.text) parts.push(item.text);
      else if (item.type === "resource" && item.resource) parts.push(item.resource.text ?? `[resource ${item.resource.uri}]`);
      else parts.push(`[${item.type} content]`);
    }

    return { text: parts.join("\n").trim() || "(no output)", error: Boolean(result.isError) };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out ${what} after ${ms / 1000}s`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
