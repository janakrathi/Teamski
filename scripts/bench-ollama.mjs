// ==========================================
// HOW FAST IS THE MODEL ON THIS SERVER
// ==========================================
//
//   node scripts/bench-ollama.mjs                  qwen3:1.7b and qwen3:4b
//   node scripts/bench-ollama.mjs lfm2.5:8b qwen3.5:4b   just these
//
// Sends requests shaped like a real Teamski turn - a
// few thousand tokens of conversation and memory in,
// a couple of hundred out - and reports, per model:
//
//   first word     how long someone stares at nothing
//   reading        prompt tokens processed per second
//   writing        tokens produced per second
//
// then fires several at once, the way a team would,
// to see whether they queue.
//
// Reads only. It loads models into memory, which
// takes RAM while it runs and for a few minutes
// after, like normal use.
//

const HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";

const asked = process.argv.slice(2);

const MODELS = asked.length > 0 ? asked : ["qwen3:1.7b", "qwen3:4b"];

// Roughly what a turn carries: instructions, memory,
// recent messages. About 2,500 tokens.

const CONTEXT = Array.from(
  { length: 60 },
  (_, n) =>
    `Message ${n + 1}: The team discussed the website launch plan, ` +
    `the payment page, DNS setup and who owns each task this week. ` +
    `Riya will review copy, Aman handles QA, Sam sets up hosting.`
).join("\n");

const QUESTION =
  "Summarise the plan above as five short bullet points with owners.";


async function turn(model) {
  const started = performance.now();

  let firstToken = null;
  let final = null;

  const response = await fetch(`${HOST}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: true,
      think: false,
      messages: [
        // A different first line every time, so Ollama
        // cannot reuse the last request's work. A new
        // conversation, or another person's, gets no
        // such head start.
        {
          role: "system",
          content: `Conversation ${Math.random().toString(36).slice(2)}
${CONTEXT}`,
        },
        { role: "user", content: QUESTION },
      ],
      options: { num_ctx: 8192, num_predict: 200, temperature: 0 },
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`${model}: ${response.status} ${await response.text()}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let newline;

    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);

      if (!line) {
        continue;
      }

      const chunk = JSON.parse(line);

      if (firstToken === null && chunk.message?.content) {
        firstToken = performance.now() - started;
      }

      if (chunk.done) {
        final = chunk;
      }
    }
  }

  const ns = 1e9;

  return {
    totalS: (performance.now() - started) / 1000,
    firstWordS: (firstToken ?? performance.now() - started) / 1000,
    loadS: (final?.load_duration ?? 0) / ns,
    promptTokens: final?.prompt_eval_count ?? 0,
    readingTps:
      final?.prompt_eval_duration
        ? final.prompt_eval_count / (final.prompt_eval_duration / ns)
        : 0,
    outputTokens: final?.eval_count ?? 0,
    writingTps:
      final?.eval_duration ? final.eval_count / (final.eval_duration / ns) : 0,
  };
}


const round = (n, d = 1) => Number(n.toFixed(d));


async function main() {
  const tags = await fetch(`${HOST}/api/tags`)
    .then((r) => r.json())
    .catch(() => null);

  if (!tags) {
    console.log(`Ollama is not answering at ${HOST}. Is it running? (systemctl status ollama)`);
    process.exit(1);
  }

  const installed = new Set((tags.models ?? []).map((m) => m.name));

  for (const model of MODELS) {
    if (!installed.has(model)) {
      console.log(`\n${model}: not installed - skipping (ollama pull ${model})`);
      continue;
    }

    console.log(`\n=== ${model} ===`);

    // The first call includes loading the model
    // from disk; the second is what people feel
    // once it is warm.

    const cold = await turn(model);
    console.log(`  cold start: loaded in ${round(cold.loadS)}s, first word after ${round(cold.firstWordS)}s`);

    const warm = await turn(model);

    console.log(`  warm, one person:`);
    console.log(`    first word after   ${round(warm.firstWordS)}s   (${warm.promptTokens} tokens of context)`);
    console.log(`    reading            ${round(warm.readingTps, 0)} tokens/s`);
    console.log(`    writing            ${round(warm.writingTps)} tokens/s   (~${round(warm.writingTps * 0.75, 0)} words/s)`);
    console.log(`    whole reply        ${round(warm.totalS)}s for ${warm.outputTokens} tokens`);

    for (const people of [3, 5]) {
      const t0 = performance.now();

      const results = await Promise.all(
        Array.from({ length: people }, () => turn(model))
      );

      const wall = (performance.now() - t0) / 1000;

      const firsts = results.map((r) => r.firstWordS).sort((a, b) => a - b);
      const writing = results.reduce((s, r) => s + r.writingTps, 0) / people;

      console.log(`  ${people} people at once:`);
      console.log(`    first word         fastest ${round(firsts[0])}s, slowest ${round(firsts.at(-1))}s`);
      console.log(`    writing each       ${round(writing)} tokens/s`);
      console.log(`    all done after     ${round(wall)}s`);
    }
  }

  const ps = await fetch(`${HOST}/api/ps`).then((r) => r.json()).catch(() => null);

  console.log(`\n=== memory ===`);

  for (const m of ps?.models ?? []) {
    console.log(`  ${m.name}: ${round((m.size ?? 0) / 1024 ** 3)} GB loaded`);
  }

  console.log(`\nSend this whole output back.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
