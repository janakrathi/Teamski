import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_MODEL,
  stripThinking,
  type OllamaMessage,
  type ToolCall,
} from "../lib/ai/ollama.ts";

import {
  getTool,
  runTool,
  specsFor,
} from "../lib/ai/tools.ts";

import { streamFor } from "../lib/ai/providers/index.ts";

import { mcpToolsFor } from "../lib/mcp/client.ts";

import { refreshSkills, skillIndex, skillsPrompt } from "../lib/ai/skills.ts";

import { githubToken } from "../lib/connections/github.ts";

import { SELF_HOSTED, allows, planHere } from "../lib/plans.ts";

import { describeError, raiseAlert } from "../lib/alerts.ts";

import {
  flattenToolMessages,
  friendlyModelError,
  isToolError,
} from "../lib/ai/errors.ts";

import {
  collectUrls,
  keepKnownLinks,
} from "../lib/ai/links.ts";

import { sendDueRenewalReminders } from "../lib/payments/reminders.ts";

import { sendDueWinbackEmails } from "../lib/email/winback.ts";

import { OLLAMA_HOST } from "../lib/ai/ollama.ts";

import {
  describeTiming,
  nextRunAt,
  type Cadence,
} from "../lib/agents/schedule.ts";

import {
  ledgerRows,
  newLedger,
  tally,
  type UsageLedger,
} from "../lib/agents/ledger.ts";


// ==========================================
// AGENT WORKER
// ==========================================
//
// Runs beside the app: `npm run worker`.
//
// It claims queued runs, advances them one step
// at a time, and checks for pause or stop
// between every step. That is what makes the
// Pause and Stop buttons mean something - the
// loop lives here, outside any request, so it
// survives a refresh, a closed tab and a restart
// of the dev server.
//

const POLL_INTERVAL_MS = 2000;

// How many runs this worker advances at once.
//
// One at a time meant a queued run waited for
// whatever was ahead of it to finish, even while
// that one sat waiting on a web page or a file.
//
// Most runs now answer on hosted models (Groq and
// people's own keys), which take many requests at
// once, so a busy project - or a hackathon full of
// them - should not queue behind two runs. A run
// that falls back to the machine's own model still
// waits its turn in Ollama, which queues what will
// not fit; that only slows it, it does not break.
// WORKER_CONCURRENCY overrides this per server.

const MAX_CONCURRENT_RUNS =
  Number(process.env.WORKER_CONCURRENCY) || 8;

// How many steps one task may take - enough for long
// research or a whole landing page in one go. Each step
// resends the task's history, so the cap keeps a run
// from wandering forever. WORKER_MAX_STEPS overrides it.
const MAX_STEPS = Number(process.env.WORKER_MAX_STEPS) || 20;

// A single step's generation budget. Without a
// cap a reasoning model can spend an unbounded
// amount of time thinking and never return.

const MAX_STEP_TOKENS = 2000;

// How often to look for a pause or stop while a
// step is still generating.

const INTERRUPT_POLL_MS = 3000;

// A run that is genuinely being worked on says
// so by keeping its claim fresh. Stop touching
// it and the run is, by definition, not being
// worked on by anyone.

const HEARTBEAT_MS = 20000;

// How quiet a claim has to go before another
// worker may take the run back. Well clear of a
// missed heartbeat or two.

const STALE_AFTER_SECONDS = 90;

const REAP_INTERVAL_MS = 30000;

const WORKER_ID = `worker-${process.pid}`;

// How often to look for scheduled agents that are
// due. A schedule says "9:00"; within half a
// minute of that is on time.

const SCHEDULE_POLL_MS = 30000;

// How often to look for Team plans about to lapse and
// email their owners. Slow - a plan lapses by the day,
// not the second - and the reminder itself only sends
// once per period.

const REMINDER_POLL_MS = 6 * 60 * 60 * 1000;

// How often to look for people who signed up, went
// quiet, and are due their one coming-back nudge. Each
// pass sends at most ten, so hourly drains a backlog at
// ten an hour and then settles into the day-to-day
// trickle of new signups. Each person is emailed once.

const WINBACK_POLL_MS = 60 * 60 * 1000;

// Skills are re-read from GitHub about once a day: every
// hour, any not checked in the last 24 hours, a batch at
// a time.
const SKILLS_POLL_MS = 60 * 60 * 1000;
const SKILLS_STALE_MS = 24 * 60 * 60 * 1000;

// A due schedule whose agent is still busy waits
// for it - but not forever. Past this, that run is
// skipped and the next one planned.

const SCHEDULE_PATIENCE_MS = 2 * 60 * 60 * 1000;


// ------------------------------------------
// CONFIG
// ------------------------------------------

function loadEnv() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  // The worker has no user session, so it needs
  // the service role key to see agent rows. This
  // key bypasses RLS - keep it server side only,
  // never in NEXT_PUBLIC_*.

  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error(
      [
        "",
        "The worker needs Supabase credentials.",
        "",
        "Add to .env.local:",
        "  SUPABASE_SERVICE_ROLE_KEY=<service role key>",
        "",
        "Find it in the Supabase dashboard under",
        "Project Settings -> API -> service_role.",
        "It bypasses row level security, so never",
        "expose it to the browser.",
        "",
      ].join("\n")
    );

    process.exit(1);
  }

  return { url, key };
}


// ------------------------------------------
// LOAD .env.local
// ------------------------------------------
//
// Next loads this for the app; a plain node
// process has to do it itself.
//

async function loadDotEnv() {
  const fs = await import("node:fs/promises");

  try {
    const raw = await fs.readFile(
      new URL("../.env.local", import.meta.url),
      "utf-8"
    );

    for (const line of raw.split("\n")) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const index = trimmed.indexOf("=");

      if (index === -1) {
        continue;
      }

      const name = trimmed.slice(0, index).trim();

      const value = trimmed
        .slice(index + 1)
        .trim()
        .replace(/^["']|["']$/g, "");

      if (!process.env[name]) {
        process.env[name] = value;
      }
    }
  } catch {
    // No .env.local is fine if the environment
    // is already populated.
  }
}


// ------------------------------------------
// TYPES
// ------------------------------------------

type AgentRun = {
  id: string;
  agent_id: string;
  project_id: string;
  channel_id: string | null;
  started_by: string | null;
  task: string;
  status: string;
  messages: OllamaMessage[];
  step: number;

  // Set when a schedule started this run.
  schedule_id?: string | null;
};

// ------------------------------------------
// EVENTS
// ------------------------------------------

async function emit(
  db: SupabaseClient,
  run: AgentRun,
  type: string,
  message: string,
  data: Record<string, unknown> = {}
) {
  const { error } = await db
    .from("agent_events")
    .insert({
      agent_id: run.agent_id,
      project_id: run.project_id,
      actor_id: null,
      type,
      message,
      data,
    });

  if (error) {
    console.error(
      "  ! could not write event:",
      error.message
    );
  }
}


// ------------------------------------------
// NOTIFY
// ------------------------------------------
//
// A background run is, by design, something you
// walked away from. Telling the person who
// started it that it finished is the other half
// of that promise.
//

async function notify(
  db: SupabaseClient,
  run: AgentRun,
  kind: "agent_done" | "agent_error",
  title: string,
  body: string
) {
  if (!run.started_by) {
    return;
  }

  const { error } = await db
    .from("notifications")
    .insert({
      user_id: run.started_by,
      project_id: run.project_id,
      channel_id: run.channel_id,
      actor_id: null,
      kind,
      title,
      body: body.slice(0, 300),
    });

  if (error) {
    console.error(
      "  ! could not notify:",
      error.message
    );
  }
}


async function setRun(
  db: SupabaseClient,
  runId: string,
  patch: Record<string, unknown>
) {
  const { error } = await db
    .from("agent_runs")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("id", runId);

  if (error) {
    console.error(
      "  ! could not update run:",
      error.message
    );
  }
}


// ------------------------------------------
// HEARTBEAT
// ------------------------------------------
//
// While a run is in this worker's hands, keep
// saying so. A claim going stale is what tells
// everyone else that the worker holding it died.
//

async function heartbeat(
  db: SupabaseClient,
  runId: string
) {
  const { error } = await db
    .from("agent_runs")
    .update({
      claimed_at: new Date().toISOString(),
    })
    .eq("id", runId)
    .eq("claimed_by", WORKER_ID);

  if (error) {
    console.error(
      "  ! heartbeat failed:",
      error.message
    );
  }
}


// ------------------------------------------
// RECOVER ABANDONED RUNS
// ------------------------------------------
//
// A worker killed mid-run leaves the row at
// 'running' with a claim nobody holds, and
// claim_agent_run only ever looks at 'queued'.
// Without this the run is stranded for good and
// the dock reports work that is not happening.
//
// The messages and step count are already on the
// row, so handing it back to the queue resumes
// the work rather than starting it over.
//

async function reapStaleRuns(db: SupabaseClient) {
  const { data, error } = await db.rpc(
    "reap_stale_runs",
    { max_age_seconds: STALE_AFTER_SECONDS }
  );

  if (error) {
    // A database without migration 0009 has no
    // reaper. Say so and carry on - everything
    // else here still works.

    console.error(
      "Could not check for abandoned runs:",
      error.message
    );

    return;
  }

  for (const run of (data as AgentRun[] | null) ??
    []) {
    console.log(
      `  recovered run ${run.id.slice(
        0,
        8
      )} at step ${run.step} - the worker holding it went away`
    );
  }
}


async function setAgentStatus(
  db: SupabaseClient,
  agentId: string,
  status: string
) {
  await db
    .from("agents")
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", agentId);
}


// ------------------------------------------
// INTERRUPTS
// ------------------------------------------
//
// Read straight from the database before each
// step, so a Pause pressed mid-step is seen the
// moment the step finishes.
//

async function readInterrupt(
  db: SupabaseClient,
  run: AgentRun
): Promise<"pause" | "stop" | null> {
  const { data } = await db
    .from("agent_runs")
    .select("status")
    .eq("id", run.id)
    .maybeSingle();

  if (data?.status === "paused") {
    return "pause";
  }

  if (data?.status === "stopped") {
    return "stop";
  }

  // The control bar acts on the agent, so honour
  // that too rather than only the run.

  const { data: agent } = await db
    .from("agents")
    .select("status")
    .eq("id", run.agent_id)
    .maybeSingle();

  if (agent?.status === "paused") {
    return "pause";
  }

  if (agent?.status === "stopped") {
    return "stop";
  }

  return null;
}


// ------------------------------------------
// ONE MODEL STEP
// ------------------------------------------

async function runStep(
  messages: OllamaMessage[],
  signal: AbortSignal,

  // Advertising a tool the run cannot use wastes
  // a step: the model calls it, gets told there
  // is no connected account, and tries again.
  tools: ReturnType<typeof specsFor>,

  // Which model answers, and whose key pays for
  // it: the person who started the run, then the
  // project's shared key, then the machine. Never
  // the worker's own.
  model: string,
  db: SupabaseClient,
  startedBy: string | null,
  projectId: string | null,

  // With the key rotation: the model that answered the
  // previous step, tried first so the run stays on one
  // key (and its prompt cache) until that key runs out.
  prefer?: string
) {
  let content = "";

  let toolCalls: ToolCall[] = [];

  let promptTokens = 0;
  let responseTokens = 0;

  const answered = await streamFor(
    db,
    startedBy,
    {
      model,

      // A background run draws on the project's
      // shared key when its starter has none. The
      // worker already holds the service role, so
      // it is its own admin client here.
      projectId,
      admin: db,

      prefer: model === "rotate/keys" ? prefer : undefined,

      // Every step of a run shares its prompt's opening,
      // so the run is its own cache group.
      cacheKey: `run:${projectId ?? "none"}`,

      messages,
      tools,
      think: true,
      signal,

      // A reasoning model left uncapped will
      // happily think in circles until nothing
      // comes back. A step has to be able to end.
      //
      // Ollama reads this; the hosted providers
      // have their own ceiling.

      options: { num_predict: MAX_STEP_TOKENS },
    }
  );

  for await (const chunk of answered.stream) {
    const part = chunk.message;

    if (part?.content) {
      content += part.content;
    }

    if (part?.tool_calls?.length) {
      toolCalls = [
        ...toolCalls,
        ...part.tool_calls,
      ];
    }

    if (chunk.done) {
      promptTokens +=
        chunk.prompt_eval_count ?? 0;

      responseTokens += chunk.eval_count ?? 0;
    }
  }

  return {
    content,
    toolCalls,
    promptTokens,
    responseTokens,

    // What actually answered, which is not always
    // what was asked for - a key over its limit
    // hands the step to another model - and whose
    // key paid for it.
    answeredWith: answered.model,
    paidBy: answered.paidBy ?? ("local" as const),
  };
}


// ------------------------------------------
// ADVANCE ONE RUN TO COMPLETION
// ------------------------------------------

async function execute(
  db: SupabaseClient,
  run: AgentRun,

  // Filled in step by step, and recorded by the
  // caller however the run ends.
  ledger: UsageLedger
) {
  // Several runs advance at once now, so their
  // lines interleave. Without the id in front,
  // "step 3" belongs to nobody.

  const tag = run.id.slice(0, 8);

  const log = (line: string) =>
    console.log(`  [${tag}] ${line}`);

  // Which accounts this run may reach into: the
  // ones connected by whoever started it. Files
  // and the web are always on for a background
  // agent - that is what it is for.

  const { data: linked } = run.started_by
    ? await db
        .from("connections")
        .select("provider")
        .eq("user_id", run.started_by)
    : { data: [] };

  // The model this agent answers with. Set per
  // channel in settings; absent means the local
  // one, which is what every run did before there
  // was a choice.

  const { data: agentRow } = await db
    .from("agents")
    .select("model")
    .eq("id", run.agent_id)
    .maybeSingle();

  // A channel with no model of its own answers
  // with whatever the person who started the run
  // chose - their Gemini key, say - the same as it
  // would in the chat.

  let personal: string | null = null;

  if (!agentRow?.model && run.started_by) {
    const { data: profile } = await db
      .from("profiles")
      .select("default_model")
      .eq("id", run.started_by)
      .maybeSingle();

    personal = (profile?.default_model as string | null) ?? null;
  }

  const model =
    (agentRow?.model as string | null) ||
    personal ||
    DEFAULT_MODEL;

  // Apps connected over MCP by whoever started
  // the run, on a plan that includes them. Tools
  // that can change things still ask, and nobody
  // is here to answer, so a background run only
  // ever reads from them.

  const apps =
    run.started_by &&
    allows(
      await planHere({
        db,
        admin: db,
        userId: run.started_by,
        projectId: run.project_id ?? null,
      }),
      "apps"
    )
      ? await mcpToolsFor(db, run.started_by)
      : { specs: [], index: new Map() };

  // The project's skills, read when a task matches one.
  const skills = await skillIndex(db, run.project_id);

  const toolSpecs = [
    ...specsFor({
      files: true,
      web: true,
      skills: skills.length > 0,

      connections: (linked ?? []).map(
        (row) => row.provider as string
      ),
    }),
    ...apps.specs,
  ];

  console.log(
    `\n> run ${run.id.slice(0, 8)} : ${run.task.slice(
      0,
      60
    )}`
  );

  await setAgentStatus(db, run.agent_id, "working");

  // A run arriving here with steps behind it is
  // one this worker picked up after another let
  // go of it. The trail should read that way
  // rather than claiming the work began twice.

  const resuming = (run.step ?? 0) > 0;

  await emit(
    db,
    run,
    resuming ? "resumed" : "started",
    resuming
      ? `Picked this back up at step ${run.step}: ${run.task}`
      : `Started: ${run.task}`,
    { runId: run.id, step: run.step ?? 0 }
  );

  // A resumed run already carries its history.

  let messages: OllamaMessage[] =
    run.messages?.length > 0
      ? run.messages
      : [
          {
            role: "system",
            content: [
              "You are a background agent in a shared workspace.",
              "Work through the task using the tools available.",
              "You can create, read, edit and list this project's files.",
              "Deleting needs a human, so ask instead of trying.",
              "When the task is done, reply with a short summary of what you did.",
            ].join(" ") + (skills.length > 0 ? `\n\n${skillsPrompt(skills)}` : ""),
          },
          {
            role: "user",
            content: run.task,
          },
        ];

  let step = run.step ?? 0;

  let totalPrompt = 0;
  let totalResponse = 0;

  // Links the agent may keep: every URL a tool returns
  // this run, plus any in the task itself. Anything else
  // it writes was invented, and is taken out - but only
  // on a run that actually searched the web.
  const knownUrls = new Set<string>();

  for (const message of messages) {
    if (message.role === "user") {
      for (const url of collectUrls(
        message.content
      )) {
        knownUrls.add(url);
      }
    }
  }

  let webSearched = false;

  const startedAt = Date.now();

  // Which model answered the last step (see runStep).
  let lastAnswered: string | undefined;

  while (step < MAX_STEPS) {

    // ----------------------------------------
    // INTERRUPT CHECK
    // ----------------------------------------

    const interrupt = await readInterrupt(db, run);

    if (interrupt === "pause") {
      log("paused");

      await setRun(db, run.id, {
        status: "paused",
        messages,
        step,
      });

      await setAgentStatus(
        db,
        run.agent_id,
        "paused"
      );

      await emit(
        db,
        run,
        "paused",
        `Paused after step ${step}. Context kept.`,
        { step }
      );

      return;
    }

    if (interrupt === "stop") {
      log("stopped");

      await setRun(db, run.id, {
        status: "stopped",
        messages,
        step,
      });

      await setAgentStatus(
        db,
        run.agent_id,
        "stopped"
      );

      await emit(
        db,
        run,
        "stopped",
        `Stopped after step ${step}.`,
        { step }
      );

      return;
    }


    // ----------------------------------------
    // MODEL STEP
    // ----------------------------------------

    step += 1;

    log(`step ${step}`);

    await emit(
      db,
      run,
      "thinking",
      `Working on step ${step}.`,
      { step }
    );

    let outcome:
      | Awaited<ReturnType<typeof runStep>>
      | undefined;

    // Watch for a pause or stop while the model
    // is still generating. Checking only between
    // steps meant a long step could not be
    // interrupted at all, which made Pause
    // useless in exactly the case you would
    // reach for it.

    const controller = new AbortController();

    let interrupted:
      | "pause"
      | "stop"
      | null = null;

    const watcher = setInterval(() => {
      void readInterrupt(db, run).then(
        (signal) => {
          if (signal && !interrupted) {
            interrupted = signal;

            controller.abort();
          }
        }
      );
    }, INTERRUPT_POLL_MS);

    // The last step gets no tools, so a run that
    // spent its steps on tools still ends with a
    // summary instead of giving up.

    const lastStep = step >= MAX_STEPS;

    try {
      outcome = await runStep(
        lastStep
          ? [
              ...messages,
              {
                role: "user",
                content:
                  "(No more tools for this task. Using what the tools returned above, write your final result now.)",
              },
            ]
          : messages,
        controller.signal,
        lastStep ? [] : toolSpecs,
        model,
        db,
        run.started_by ?? null,
        run.project_id ?? null,
        lastAnswered
      );

      lastAnswered = outcome.answeredWith;
    } catch (error) {
      // A tool or template error (an invented tool, a
      // bad MCP schema, gpt-oss refusing the tool list):
      // the tools broke the turn, not the task. Retry
      // this step once with no tools before giving up,
      // so one bad tool cannot kill a whole run. The same
      // backstop the chat route has.

      if (
        !interrupted &&
        !lastStep &&
        toolSpecs.length > 0 &&
        isToolError(error)
      ) {
        try {
          log("tools rejected; retrying step without them");

          // Flatten tool call/result messages to plain
          // text, or gpt-oss's template fails again on
          // rendering them with no tools defined.
          outcome = await runStep(
            flattenToolMessages(messages),
            controller.signal,
            [],
            model,
            db,
            run.started_by ?? null,
            run.project_id ?? null
          );
        } catch {
          // Retry failed too - fall through to the error
          // handling below with the original error.
        }
      }

      // An abort here is a human pressing a
      // button, not a failure.

      if (!outcome && interrupted) {
        clearInterval(watcher);

        const halted: "pause" | "stop" =
          interrupted;

        log(`${halted}d mid-step`);

        await setRun(db, run.id, {
          status:
            halted === "pause"
              ? "paused"
              : "stopped",
          messages,
          step: step - 1,
        });

        await setAgentStatus(
          db,
          run.agent_id,
          halted === "pause"
            ? "paused"
            : "stopped"
        );

        await emit(
          db,
          run,
          halted === "pause"
            ? "paused"
            : "stopped",
          halted === "pause"
            ? `Paused during step ${step}. Context kept.`
            : `Stopped during step ${step}.`,
          { step }
        );

        return;
      }

      // The retry above recovered: fall through to the
      // success path with the tool-free outcome.
      if (outcome) {
        clearInterval(watcher);
      } else {

      const message =
        error instanceof Error
          ? error.message
          : "The model call failed.";

      // One plain sentence for the person; the raw
      // message stays in the log and the alert.
      const shown = friendlyModelError(error);

      console.error("  ! " + message);

      // Teamski's problem, not the person's key or
      // allowance: see the same check in the chat
      // route.

      if (
        typeof (error as { status?: unknown } | null)?.status !== "number" &&
        !(error instanceof Error && error.name === "DailyLimitError")
      ) {
        await raiseAlert("worker", {
          key: /reach Ollama/i.test(message) ? "ai-down" : "run-error",
          title: /reach Ollama/i.test(message)
            ? "The built-in AI is not answering background tasks"
            : "A background task failed",
          detail: `Run ${run.id} in project ${run.project_id}\n\n${describeError(error)}`,
        });
      }

      clearInterval(watcher);

      await setRun(db, run.id, {
        status: "error",
        error: shown,
        messages,
        step,
      });

      await setAgentStatus(
        db,
        run.agent_id,
        "error"
      );

      await emit(
        db,
        run,
        "error",
        shown,
        { step }
      );

      await notify(
        db,
        run,
        "agent_error",
        "Your agent stopped with an error",
        shown
      );

      await scheduleFailed(db, run, message);

      return;

      }
    }

    clearInterval(watcher);

    totalPrompt += outcome.promptTokens;
    totalResponse += outcome.responseTokens;

    tally(ledger, outcome);


    // ----------------------------------------
    // FINISHED
    // ----------------------------------------

    if (outcome.toolCalls.length === 0) {
      const written = stripThinking(outcome.content);

      // On a web run, keep only the links the search or
      // the page-reads actually returned; drop any the
      // agent invented.
      const answer = webSearched
        ? keepKnownLinks(written, knownUrls)
        : written;

      log(`done: ${answer.slice(0, 70)}`);

      await setRun(db, run.id, {
        status: "done",
        result: answer,
        messages,
        step,
      });

      await setAgentStatus(
        db,
        run.agent_id,
        "idle"
      );

      await emit(
        db,
        run,
        "completed",
        answer || "Finished.",
        {
          step,
          promptTokens: totalPrompt,
          responseTokens: totalResponse,
          ms: Date.now() - startedAt,
        }
      );

      await notify(
        db,
        run,
        "agent_done",
        "Your agent finished",
        answer || run.task
      );

      await postScheduledAnswer(db, run, answer);

      return;
    }


    // ----------------------------------------
    // TOOL CALLS
    // ----------------------------------------

    messages = [
      ...messages,
      {
        role: "assistant",
        content: outcome.content,
        tool_calls: outcome.toolCalls,
      },
    ];

    for (const call of outcome.toolCalls) {
      const name = call.function?.name ?? "";

      const args = (call.function?.arguments ??
        {}) as Record<string, string>;

      const definition = getTool(name);

      await emit(
        db,
        run,
        "working",
        definition?.runningLabel(args) ??
          apps.index.get(name)?.label ??
          `Running ${name}`,
        { tool: name, args, step }
      );

      // A background agent has nobody watching,
      // so destructive tools stay refused. The
      // approval gate lives in the registry.
      //
      // Connected accounts belong to whoever
      // started the run, not to the worker. A run
      // with no starter - one made by hand, say -
      // gets no access to anybody's spreadsheet,
      // which is the right answer rather than a
      // missing feature.

      const result = await runTool(name, args, {
        db,
        userId: run.started_by ?? undefined,
        mcp: apps.index,

        // Only this run's project's files.
        projectId: run.project_id,
      });

      log(`  ${result.doneLabel}`);

      await emit(
        db,
        run,
        result.needsApproval
          ? "message"
          : "working",
        result.doneLabel,
        {
          tool: name,
          ok: result.ok,
          needsApproval:
            result.needsApproval ?? false,
          step,
        }
      );

      // Remember the real URLs this tool returned, and
      // note when the web itself was used.
      for (const url of collectUrls(result.result)) {
        knownUrls.add(url);
      }

      if (
        name === "web_search" ||
        name === "fetch_page"
      ) {
        webSearched = true;
      }

      messages = [
        ...messages,
        {
          role: "tool",
          tool_name: name,
          content: result.result,
        },
      ];
    }

    await setRun(db, run.id, {
      messages,
      step,
    });
  }


  // ----------------------------------------
  // OUT OF STEPS
  // ----------------------------------------

  log("ran out of steps");

  await setRun(db, run.id, {
    status: "error",
    error: `Stopped after ${MAX_STEPS} steps.`,
    messages,
    step,
  });

  await setAgentStatus(db, run.agent_id, "error");

  await emit(
    db,
    run,
    "error",
    `Gave up after ${MAX_STEPS} steps without finishing.`,
    { step }
  );

  await scheduleFailed(
    db,
    run,
    `Gave up after ${MAX_STEPS} steps without finishing.`
  );
}


// ==========================================
// SCHEDULED AGENTS
// ==========================================
//
// A schedule is due when its next time has passed.
// Starting one is: move its next time forward -
// only if nobody else already has, which is what
// stops two workers starting it twice - then queue
// an ordinary run, which the loop claims like any
// other.
//

type Schedule = {
  id: string;
  project_id: string;
  channel_id: string;
  created_by: string | null;
  title: string;
  task: string;
  cadence: Cadence;
  time_of_day: string;
  weekday: number | null;
  month_day: number | null;
  timezone: string;
  next_run_at: string;
};

let schedulesMissing = false;


async function startDueSchedules(db: SupabaseClient) {
  if (schedulesMissing) {
    return;
  }

  const now = new Date();

  const { data, error } = await db
    .from("agent_schedules")
    .select(
      "id, project_id, channel_id, created_by, title, task, cadence, time_of_day, weekday, month_day, timezone, next_run_at"
    )
    .eq("enabled", true)
    .lte("next_run_at", now.toISOString())
    .order("next_run_at", { ascending: true })
    .limit(20);

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      // Migration 0023 not run: no schedules to
      // look for, and no need to keep asking.
      schedulesMissing = true;

      console.log(
        "  (scheduled agents off: run supabase/migrations/0023_agent_schedules.sql)"
      );

      return;
    }

    console.error("  ! could not read schedules:", error.message);

    return;
  }

  for (const schedule of (data ?? []) as Schedule[]) {
    try {
      await startSchedule(db, schedule, now);
    } catch (cause) {
      console.error(
        `  ! schedule ${schedule.id.slice(0, 8)}:`,
        cause instanceof Error ? cause.message : cause
      );
    }
  }
}


async function startSchedule(
  db: SupabaseClient,
  schedule: Schedule,
  now: Date
) {
  const tag = `schedule ${schedule.id.slice(0, 8)}`;

  const timing = {
    cadence: schedule.cadence,
    timeOfDay: schedule.time_of_day,
    weekday: schedule.weekday,
    monthDay: schedule.month_day,
    timezone: schedule.timezone,
  };

  const next = nextRunAt(timing, now).toISOString();

  // Moves the schedule on, as long as it is still
  // where this worker found it. Says whether this
  // worker was the one that did.

  const advance = async (fields: Record<string, unknown>) => {
    const { data } = await db
      .from("agent_schedules")
      .update({
        next_run_at: next,
        updated_at: now.toISOString(),
        ...fields,
      })
      .eq("id", schedule.id)
      .eq("next_run_at", schedule.next_run_at)
      .select("id")
      .maybeSingle();

    return Boolean(data);
  };

  const off = (reason: string) =>
    db
      .from("agent_schedules")
      .update({
        enabled: false,
        last_error: reason,
        updated_at: now.toISOString(),
      })
      .eq("id", schedule.id);

  // It runs as whoever added it: their allowance,
  // their connected apps. Somebody who has left
  // cannot be run as.

  if (!schedule.created_by) {
    await off("Turned off: the person who added this schedule no longer has an account.");

    return;
  }

  const { data: member } = await db
    .from("project_members")
    .select("user_id")
    .eq("project_id", schedule.project_id)
    .eq("user_id", schedule.created_by)
    .maybeSingle();

  if (!member) {
    await off("Turned off: the person who added this schedule has left the project.");

    return;
  }

  const { data: agent } = await db
    .from("agents")
    .select("id")
    .eq("channel_id", schedule.channel_id)
    .maybeSingle();

  if (!agent) {
    await advance({ last_error: "Skipped: this channel has no agent." });

    return;
  }

  // One run per agent at a time. A busy agent gets
  // a while to finish before this run is skipped.

  const { data: busy } = await db
    .from("agent_runs")
    .select("id")
    .eq("agent_id", agent.id)
    .in("status", ["queued", "running", "paused"])
    .limit(1)
    .maybeSingle();

  if (busy) {
    const late = now.getTime() - new Date(schedule.next_run_at).getTime();

    if (late > SCHEDULE_PATIENCE_MS) {
      await advance({
        last_error: "Skipped: the agent was still busy with another task.",
      });
    }

    return;
  }

  if (!(await advance({ last_run_at: now.toISOString(), last_error: null }))) {
    // Another worker got there first.
    return;
  }

  const { data: run, error } = await db
    .from("agent_runs")
    .insert({
      agent_id: agent.id,
      project_id: schedule.project_id,
      channel_id: schedule.channel_id,
      started_by: schedule.created_by,
      task: schedule.task,
      status: "queued",
      schedule_id: schedule.id,
    })
    .select("id")
    .single();

  if (error || !run) {
    await db
      .from("agent_schedules")
      .update({
        last_error: `Could not start: ${error?.message ?? "unknown error"}`,
      })
      .eq("id", schedule.id);

    return;
  }

  await db
    .from("agent_schedules")
    .update({ last_run_id: run.id })
    .eq("id", schedule.id);

  await db
    .from("agents")
    .update({
      status: "working",
      current_task: schedule.task,
      updated_at: now.toISOString(),
    })
    .eq("id", agent.id);

  console.log(
    `  [${tag}] started "${schedule.title}" (${describeTiming(timing)}), next ${next}`
  );
}


// A scheduled run's answer belongs in the channel
// it was scheduled for, where everyone sees it -
// that is the point of "every Monday, summarise
// the week". Headed with what it is, so nobody
// wonders why the agent spoke unprompted.

async function postScheduledAnswer(
  db: SupabaseClient,
  run: AgentRun,
  answer: string
) {
  if (!run.schedule_id || !run.channel_id || !answer.trim()) {
    return;
  }

  const { data: schedule } = await db
    .from("agent_schedules")
    .select("title, cadence, time_of_day, weekday, month_day, timezone")
    .eq("id", run.schedule_id)
    .maybeSingle();

  const heading = schedule
    ? `**${schedule.title}** · _${describeTiming({
        cadence: schedule.cadence as Cadence,
        timeOfDay: schedule.time_of_day as string,
        weekday: schedule.weekday as number | null,
        monthDay: schedule.month_day as number | null,
        timezone: schedule.timezone as string,
      })}_`
    : "**Scheduled task**";

  const { error } = await db.from("messages").insert({
    project_id: run.project_id,
    channel_id: run.channel_id,
    user_id: null,
    role: "assistant",
    content: `${heading}\n\n${answer}`,
  });

  if (error) {
    console.error("  ! could not post the scheduled answer:", error.message);
  }
}


async function scheduleFailed(
  db: SupabaseClient,
  run: AgentRun,
  message: string
) {
  if (!run.schedule_id) {
    return;
  }

  await db
    .from("agent_schedules")
    .update({ last_error: `Last run failed: ${message}`.slice(0, 500) })
    .eq("id", run.schedule_id);
}


// ------------------------------------------
// WHAT A RUN USED
// ------------------------------------------
//
// See lib/agents/ledger.ts. Recorded however the
// run ends: a stopped or failed run still made the
// calls, and the provider counted them.

async function recordRunUsage(
  db: SupabaseClient,
  run: AgentRun,
  ledger: UsageLedger
) {
  const rows = ledgerRows(ledger, run);

  if (rows.length === 0) {
    return;
  }

  const { error } = await db.from("usage_events").insert(rows);

  if (error) {
    console.error(
      "  ! could not record usage:",
      error.message
    );
  }
}


// ------------------------------------------
// IS EVERYTHING STILL ANSWERING
// ------------------------------------------
//
// Every few minutes: can the built-in AI be
// reached, and does the database answer. An email
// when either stops, and another when it is back.
// The first check waits a minute, so a restart of
// Ollama alongside the worker is not an alert.
//

const HEALTH_EVERY_MS = 5 * 60 * 1000;


async function watchHealth(db: SupabaseClient) {
  await sleep(60_000);

  for (;;) {
    try {
      const ai = await fetch(`${OLLAMA_HOST}/api/tags`, {
        signal: AbortSignal.timeout(10_000),
      })
        .then((response) => response.ok)
        .catch(() => false);

      await raiseAlert("worker", {
        key: "ai-down",
        level: ai ? "resolved" : "problem",
        title: ai
          ? "The built-in AI is answering again"
          : "The built-in AI (Ollama) is not answering",
        detail: ai
          ? `${OLLAMA_HOST} answered.`
          : `No answer from ${OLLAMA_HOST}. On the server: systemctl status ollama`,
      });

      const { error } = await db
        .from("projects")
        .select("id", { head: true, count: "exact" })
        .limit(1);

      await raiseAlert("worker", {
        key: "db-down",
        level: error ? "problem" : "resolved",
        title: error
          ? "The database is not answering"
          : "The database is answering again",
        detail: error ? error.message : "",
      });
    } catch (error) {
      console.error("Health check failed:", error);
    }

    await sleep(HEALTH_EVERY_MS);
  }
}


// ------------------------------------------
// MAIN LOOP
// ------------------------------------------

async function main() {
  await loadDotEnv();

  const { url, key } = loadEnv();

  const db = createClient(url, key, {
    auth: { persistSession: false },
  });

  console.log(
    [
      "",
      `Agent worker ${WORKER_ID}`,
      `  model   ${DEFAULT_MODEL}`,
      `  at once ${MAX_CONCURRENT_RUNS} run${
        MAX_CONCURRENT_RUNS === 1 ? "" : "s"
      }`,
      `  poll    every ${POLL_INTERVAL_MS}ms`,
      ...(SELF_HOSTED ? ["  mode    self-hosted (no billing or win-back emails)"] : []),
      "",
      "Waiting for runs. Ctrl+C to stop.",
    ].join("\n")
  );

  let running = true;

  process.on("SIGINT", () => {
    console.log("\nShutting down.");
    running = false;
  });

  // Something nothing else caught. pm2 starts the
  // worker again, but somebody should know why it
  // had to.

  process.on("uncaughtException", (error) => {
    console.error("Worker crashed:", error);

    void raiseAlert("worker", {
      key: "worker-crash",
      title: "The worker crashed and is restarting",
      detail: describeError(error),
    }).finally(() => process.exit(1));
  });

  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection in the worker:", reason);

    void raiseAlert("worker", {
      key: "worker-rejection",
      title: "The worker hit an error nothing handled",
      detail: describeError(reason),
    });
  });

  void watchHealth(db);

  // Anything stranded by a previous worker is
  // this worker's to rescue, and startup is when
  // it matters most: a crash or a reboot is the
  // usual reason a run was abandoned.

  await reapStaleRuns(db);

  let lastReap = Date.now();

  // Zero, so the first pass checks straight away:
  // a schedule that came due while the worker was
  // down starts now.
  let lastSchedules = 0;

  let lastReminders = 0;

  let lastWinback = 0;

  let lastSkills = 0;

  // The runs this worker currently holds. The
  // loop claims while there is room and never
  // awaits a run, so a slow one no longer blocks
  // the ones behind it.

  const inFlight = new Set<Promise<void>>();

  function start(run: AgentRun) {
    // Hold the claim open for as long as the run
    // actually takes. execute() has many ways
    // out, so the beat is started and stopped
    // around it rather than inside.

    const attempt = (async () => {
      const beat = setInterval(() => {
        void heartbeat(db, run.id);
      }, HEARTBEAT_MS);

      const ledger = newLedger();

      try {
        await execute(db, run, ledger);
      } catch (error) {
        // One run failing is not the worker
        // failing. Say so and let the others
        // carry on.

        console.error(
          `  ! run ${run.id.slice(0, 8)} threw:`,
          error instanceof Error
            ? error.message
            : error
        );

        await raiseAlert("worker", {
          key: "run-crash",
          title: "A background task crashed the worker's run loop",
          detail: `Run ${run.id} in project ${run.project_id}\n\n${describeError(error)}`,
        });

        await setRun(db, run.id, {
          status: "error",

          error:
            error instanceof Error
              ? error.message
              : "The run failed.",
        });

        await setAgentStatus(
          db,
          run.agent_id,
          "idle"
        );
      } finally {
        clearInterval(beat);

        await recordRunUsage(db, run, ledger);
      }
    })();

    inFlight.add(attempt);

    void attempt.finally(() => {
      inFlight.delete(attempt);
    });
  }

  while (running) {
    try {
      if (
        Date.now() - lastReap >
        REAP_INTERVAL_MS
      ) {
        lastReap = Date.now();

        await reapStaleRuns(db);
      }

      if (Date.now() - lastSchedules > SCHEDULE_POLL_MS) {
        lastSchedules = Date.now();

        await startDueSchedules(db);
      }

      // Billing reminders and win-back emails are
      // teamski.in's own; a self-hosted copy sends
      // neither.

      if (
        !SELF_HOSTED &&
        Date.now() - lastReminders >
        REMINDER_POLL_MS
      ) {
        lastReminders = Date.now();

        await sendDueRenewalReminders(db).catch(
          (error) =>
            console.error(
              "Renewal reminders failed:",
              error
            )
        );
      }

      if (
        !SELF_HOSTED &&
        Date.now() - lastWinback >
        WINBACK_POLL_MS
      ) {
        lastWinback = Date.now();

        await sendDueWinbackEmails(db).catch(
          (error) =>
            console.error(
              "Coming-back nudges failed:",
              error
            )
        );
      }

      // Skills follow their repos, on teamski.in and on a
      // self-hosted copy alike.
      if (Date.now() - lastSkills > SKILLS_POLL_MS) {
        lastSkills = Date.now();

        await refreshSkills(db, {
          olderThanMs: SKILLS_STALE_MS,
          limit: 40,
          tokenFor: async (userId) => {
            const found = await githubToken(db, userId).catch(() => null);

            return found && found.ok ? found.token : null;
          },
        })
          .then((synced) => {
            if (synced.updated.length > 0 || synced.failed.length > 0) {
              console.log(
                `[skills] ${synced.updated.length} updated, ${synced.unchanged.length} unchanged, ${synced.failed.length} failed`
              );
            }
          })
          .catch((error) => console.error("Skill sync failed:", error));
      }

      // Full. Wait for a slot rather than
      // claiming work this worker cannot start.

      if (inFlight.size >= MAX_CONCURRENT_RUNS) {
        await Promise.race(inFlight);

        continue;
      }

      const { data, error } = await db.rpc(
        "claim_agent_run",
        { worker_id: WORKER_ID }
      );

      if (error) {
        console.error(
          "Could not claim a run:",
          error.message
        );

        await sleep(5000);

        continue;
      }

      const run = (
        data as AgentRun[] | null
      )?.[0];

      if (!run) {
        // Nothing waiting. Sleep, but wake early
        // if something in flight finishes, so a
        // freed slot is filled at once.

        await Promise.race([
          sleep(POLL_INTERVAL_MS),
          ...inFlight,
        ]);

        continue;
      }

      start(run);
    } catch (error) {
      console.error(
        "Worker loop error:",
        error instanceof Error
          ? error.message
          : error
      );

      await raiseAlert("worker", {
        key: "worker-loop",
        title: "The worker keeps hitting an error while looking for tasks",
        detail: describeError(error),
      });

      await sleep(5000);
    }
  }

  // Ctrl+C stops taking new work; it should not
  // abandon what is already running, since an
  // abandoned run stays claimed until the reaper
  // notices.

  if (inFlight.size > 0) {
    console.log(
      `Finishing ${inFlight.size} run${
        inFlight.size === 1 ? "" : "s"
      } already in progress.`
    );

    await Promise.allSettled(inFlight);
  }

  process.exit(0);
}


function sleep(ms: number) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}


main();
