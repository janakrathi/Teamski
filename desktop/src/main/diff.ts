// ==========================================
// DIFFS FOR PEOPLE
// ==========================================
//
// What an edit will change, shown before it is
// approved and kept in the transcript after. A plain
// line diff with a little context is all a person
// needs to judge an edit.
//

const CONTEXT = 3;

// Longest-common-subsequence line diff. Big files fall
// back to "trim the common start and end", which is
// what an edit almost always is anyway.
export function lineDiff(before: string, after: string, file = ""): string {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);

  // Trim the shared start and end first.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;

  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }

  const midA = a.slice(start, endA + 1);
  const midB = b.slice(start, endB + 1);

  if (midA.length === 0 && midB.length === 0) {
    return "";
  }

  type Op = { tag: " " | "-" | "+"; text: string };
  let ops: Op[];

  if (midA.length * midB.length <= 4_000_000) {
    // Classic LCS table on the changed middle.
    const rows = midA.length + 1;
    const cols = midB.length + 1;
    const table = new Uint32Array(rows * cols);

    for (let i = midA.length - 1; i >= 0; i--) {
      for (let j = midB.length - 1; j >= 0; j--) {
        table[i * cols + j] =
          midA[i] === midB[j]
            ? table[(i + 1) * cols + j + 1] + 1
            : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
      }
    }

    ops = [];
    let i = 0;
    let j = 0;

    while (i < midA.length && j < midB.length) {
      if (midA[i] === midB[j]) {
        ops.push({ tag: " ", text: midA[i] });
        i++;
        j++;
      } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) {
        ops.push({ tag: "-", text: midA[i++] });
      } else {
        ops.push({ tag: "+", text: midB[j++] });
      }
    }

    while (i < midA.length) ops.push({ tag: "-", text: midA[i++] });
    while (j < midB.length) ops.push({ tag: "+", text: midB[j++] });
  } else {
    ops = [
      ...midA.map((text) => ({ tag: "-" as const, text })),
      ...midB.map((text) => ({ tag: "+" as const, text })),
    ];
  }

  const before_ = a.slice(Math.max(0, start - CONTEXT), start).map((text) => ({ tag: " " as const, text }));
  const after_ = a.slice(endA + 1, endA + 1 + CONTEXT).map((text) => ({ tag: " " as const, text }));

  const all = [...before_, ...ops, ...after_];

  // Collapse long unchanged runs inside the hunk.
  const lines: string[] = [];
  let run: Op[] = [];

  const flush = (final: boolean) => {
    if (run.length > CONTEXT * 2 + 1 && !final) {
      lines.push(...run.slice(0, CONTEXT).map((op) => ` ${op.text}`));
      lines.push("@@ ... @@");
      lines.push(...run.slice(-CONTEXT).map((op) => ` ${op.text}`));
    } else {
      lines.push(...run.map((op) => ` ${op.text}`));
    }
    run = [];
  };

  for (const op of all) {
    if (op.tag === " ") {
      run.push(op);
    } else {
      flush(false);
      lines.push(`${op.tag}${op.text}`);
    }
  }

  flush(true);

  const firstLine = Math.max(1, start - CONTEXT + 1);
  const header = file ? `--- ${file}\n+++ ${file}\n` : "";

  const body = lines.slice(0, 600).join("\n");
  const more = lines.length > 600 ? `\n... ${lines.length - 600} more lines` : "";

  return `${header}@@ line ${firstLine} @@\n${body}${more}`;
}

export function countChanges(diff: string) {
  let added = 0;
  let removed = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }

  return { added, removed };
}
