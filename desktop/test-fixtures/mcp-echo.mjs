// A tiny MCP server for the tests: one tool, "shout",
// that upper-cases its input. Spoken to over stdio.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "echo", version: "1.0.0" });

server.registerTool(
  "shout",
  { description: "Upper-case some text", inputSchema: { text: z.string() } },
  async ({ text }) => ({ content: [{ type: "text", text: text.toUpperCase() }] })
);

await server.connect(new StdioServerTransport());
