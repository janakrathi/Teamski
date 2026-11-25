import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Session, newSessionData, type AgentDeps } from "./agent.ts";
import { runHooks } from "./hooks.ts";
import { McpHub, mcpToolName } from "./mcp.ts";
import type { StreamEvent, StreamRequest } from "./models.ts";
import { parseDuckDuckGoHtml } from "./search.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

function project() {
  const root = mkdtempSync(path.join(os.tmpdir(), "teamski-features-"));
  writeFileSync(path.join(root, "a.txt"), "one\n");
  return root;
}

function scripted(steps: StreamEvent[][]) {
  const seen: StreamRequest[] = [];
  let index = 0;

  async function* stream(request: StreamRequest): AsyncGenerator<StreamEvent> {
    seen.push({ ...request, messages: [...request.messages] });
    for (const event of steps[index++] ?? [{ type: "text", delta: "done" }]) yield event;
  }

  return { stream, seen };
}

const call = (id: string, name: string, args: unknown): StreamEvent => ({
  type: "tool-call",
  call: { id, name, arguments: JSON.stringify(args) },
});

function deps(stream: AgentDeps["stream"], extra: Partial<AgentDeps> = {}): AgentDeps {
  return {
    resolveModel: () => ({ provider: "groq", kind: "openai", baseUrl: "http://x", key: "k", model: "m" }),
    mode: () => "full-auto",
    showThinking: () => false,
    sandbox: async () => ({ enabled: false, strong: false }),
    save: () => {},
    emit: () => {},
    stream,
    prompt: async () => "system",
    ...extra,
  };
}

test("undo puts edited and created files back, and cuts the conversation there", async () => {
  const root = project();

  try {
    const { stream } = scripted([
      [call("1", "read_file", { path: "a.txt" })],
      [call("2", "edit_file", { path: "a.txt", old_string: "one", new_string: "two" })],
      [call("3", "write_file", { path: "new.txt", content: "fresh" })],
      [{ type: "text", delta: "Done." }],
    ]);

    const session = new Session(newSessionData(root, "groq::m"), deps(stream));
    await session.send("change things");

    assert.equal(readFileSync(path.join(root, "a.txt"), "utf8"), "two\n");
    assert.ok(existsSync(path.join(root, "new.txt")));
    assert.deepEqual(session.view().undoable, [0]);

    const result = await session.rewind(0);

    assert.equal(result?.text, "change things");
    assert.equal(result?.restored, 2);
    assert.equal(readFileSync(path.join(root, "a.txt"), "utf8"), "one\n");
    assert.ok(!existsSync(path.join(root, "new.txt")));
    assert.equal(session.data.messages.length, 0);
    assert.equal(session.data.items.filter((item) => item.kind === "user").length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("read-only calls in one step run side by side, results in order", async () => {
  const root = project();
  writeFileSync(path.join(root, "b.txt"), "bee\n");

  try {
    const { stream, seen } = scripted([
      [call("1", "read_file", { path: "a.txt" }), call("2", "read_file", { path: "b.txt" })],
      [{ type: "text", delta: "ok" }],
    ]);

    const session = new Session(newSessionData(root, "groq::m"), deps(stream));
    await session.send("read both");

    const tools = seen[1].messages.filter((message) => message.role === "tool");
    assert.match(tools[0].content, /one/);
    assert.match(tools[1].content, /bee/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a helper agent researches with read-only tools and reports back", async () => {
  const root = project();

  try {
    // Main asks for a helper; the helper reads a file and reports; main finishes.
    const { stream, seen } = scripted([
      [call("1", "task", { description: "Read a.txt", prompt: "What is in a.txt?" })],
      [call("h1", "read_file", { path: "a.txt" })],
      [{ type: "text", delta: "a.txt:1 says one" }],
      [{ type: "text", delta: "The file says one." }],
    ]);

    const session = new Session(newSessionData(root, "groq::m"), deps(stream));
    await session.send("use a helper");

    assert.equal(seen[1].tools.some((tool) => tool.name === "edit_file"), false);
    const report = seen[3].messages.at(-1);
    assert.equal(report?.role, "tool");
    assert.match(report?.content ?? "", /a\.txt:1 says one/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a long conversation is summarised, keeping the recent part", async () => {
  const root = project();

  try {
    const big = "x".repeat(20_000);
    let summaries = 0;

    async function* stream(request: StreamRequest): AsyncGenerator<StreamEvent> {
      if (request.tools.length === 0) {
        summaries++;
        yield { type: "text", delta: "SUMMARY: user asked for big things." };
        return;
      }
      yield { type: "text", delta: "ok" };
    }

    const session = new Session(newSessionData(root, "groq::m"), deps(stream));

    // Groq's budget is 60k characters; four big turns cross 75% of it.
    for (let i = 0; i < 4; i++) await session.send(`turn ${i} ${big}`);
    await session.send("and now?");

    assert.ok(summaries >= 1);
    assert.match(session.data.messages[0].content, /Summary of the conversation so far/);
    assert.equal(session.data.messages.at(-2)?.content, "and now?");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("hooks: exit 2 blocks with the hook's reason, exit 0 adds context", async () => {
  const root = project();
  const file = path.join(root, "hooks.json");
  // PowerShell runs a quoted program path only after "&".
  const node = `${process.platform === "win32" ? "& " : ""}${JSON.stringify(process.execPath)}`;

  writeFileSync(
    file,
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: "write_file",
            hooks: [{ type: "command", command: `${node} -e "process.stderr.write('no writes today'); process.exit(2)"` }],
          },
        ],
        UserPromptSubmit: [{ hooks: [{ type: "command", command: `${node} -e "console.log('branch: main')"` }] }],
      },
    })
  );

  try {
    const blocked = await runHooks(file, "PreToolUse", { tool_name: "write_file" }, root, "write_file");
    assert.equal(blocked.blocked, true);
    assert.match(blocked.reason, /no writes today/);

    const other = await runHooks(file, "PreToolUse", { tool_name: "read_file" }, root, "read_file");
    assert.equal(other.blocked, false);

    const context = await runHooks(file, "UserPromptSubmit", { prompt: "hi" }, root);
    assert.match(context.context, /branch: main/);

    // In the loop: the write is refused and the model hears why.
    const { stream, seen } = scripted([
      [call("1", "write_file", { path: "x.txt", content: "x" })],
      [{ type: "text", delta: "ok" }],
    ]);
    const session = new Session(newSessionData(root, "groq::m"), deps(stream, { hooksFile: file }));
    await session.send("write it");

    assert.ok(!existsSync(path.join(root, "x.txt")));
    assert.match(seen[1].messages.at(-1)?.content ?? "", /no writes today/);
    assert.match(seen[0].messages[0].content, /branch: main/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a sandboxed command can't reach the network, and is told how to ask", async () => {
  const root = project();

  try {
    const { stream, seen } = scripted([
      [call("1", "run_command", { command: "git ls-remote https://github.com/janakrathi/Teamski.git" })],
      [{ type: "text", delta: "ok" }],
    ]);

    const session = new Session(
      newSessionData(root, "groq::m"),
      deps(stream, { sandbox: async () => ({ enabled: true, strong: false }) })
    );
    await session.send("check the remote");

    const result = seen[1].messages.at(-1)?.content ?? "";
    assert.doesNotMatch(result, /Exit code 0\./);
    assert.match(result, /needs_network/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP: tools from a real stdio server are listed and called", { timeout: 60000 }, async () => {
  const root = project();
  const file = path.join(root, "mcp.json");
  const script = path.resolve(here, "../../test-fixtures/mcp-echo.mjs");

  writeFileSync(file, JSON.stringify({ mcpServers: { echo: { command: process.execPath, args: [script] } } }));

  const hub = new McpHub(file);

  try {
    await hub.ensure();
    const states = hub.states();
    assert.equal(states[0].status, "connected", states[0].error);
    assert.ok(hub.schemas().some((schema) => schema.name === mcpToolName("echo", "shout")));

    const result = await hub.call(mcpToolName("echo", "shout"), { text: "hello" }, new AbortController().signal);
    assert.equal(result.text, "HELLO");
  } finally {
    await hub.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("DuckDuckGo results are read from its HTML page", () => {
  const html = `<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnodejs.org%2Fapi%2Ftest.html&amp;rut=x">Test runner | Node.js</a>
    <a class="result__snippet" href="x">The <b>node:test</b> module facilitates the creation of JavaScript tests.</a>`;
  const results = parseDuckDuckGoHtml(html);
  assert.equal(results[0].url, "https://nodejs.org/api/test.html");
  assert.match(results[0].snippet, /node:test module/);
});

test("update versions compare as numbers, not text", async () => {
  const { newer } = await import("./update.ts");
  assert.equal(newer("0.10.0", "0.9.0"), true);
  assert.equal(newer("0.2.0", "0.2.0"), false);
  assert.equal(newer("0.1.9", "0.2.0"), false);
  assert.equal(newer("1.0.0", "0.99.99"), true);
});
