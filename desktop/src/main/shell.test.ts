import assert from "node:assert/strict";
import test from "node:test";

import { runCommand } from "./shell.ts";

// The model reads exit codes to decide whether tests
// passed, so they must be the program's own - not
// PowerShell's 0-or-1.

const node = `${process.platform === "win32" ? "& " : ""}${JSON.stringify(process.execPath)}`;

const cases: [string, number][] = [
  [`${node} -e "process.exit(3)"`, 3],
  [`${node} -e "process.exit(0)"`, 0],
  [`${node} -e "console.log('hi')"`, 0],
];

for (const [command, code] of cases) {
  test(`a command's own exit code comes through (${code})`, async () => {
    const result = await runCommand({ command, cwd: process.cwd(), timeoutMs: 30000 });
    assert.equal(result.exitCode, code, result.output);
  });
}

test("a command that fails without an exit code of its own reports failure", async () => {
  const command = process.platform === "win32" ? "Get-Item C:\\does-not-exist-teamski" : "ls /does-not-exist-teamski";
  const result = await runCommand({ command, cwd: process.cwd(), timeoutMs: 30000 });
  assert.notEqual(result.exitCode, 0);
});
