import {
  isLocal,
  serviceOf,
  streamFor,
} from "@/lib/ai/providers";

import {
  GROQ_DEFAULT_MODEL,
  GROQ_VISION_MODEL,
  groqKey,
} from "@/lib/ai/providers/groq";

import {
  CEREBRAS_DEFAULT_MODEL,
  CEREBRAS_VISION_MODEL,
  cerebrasKey,
} from "@/lib/ai/providers/cerebras";

import { adminClient } from "@/lib/supabase/admin";

import { after } from "next/server";

import { describeError, raiseAlert } from "@/lib/alerts";

import {
  DEFAULT_MODEL,
  OllamaUnreachableError,
  localBusy,
  stripThinking,
  type OllamaMessage,
  type ToolCall,
} from "@/lib/ai/ollama";

import {
  buildContext,
  extractFacts,
  sanitiseHistory,
  updateRollingSummary,
  type Scope,
} from "@/lib/ai/memory";

import { createClient } from "@/lib/supabase/server";

import { recordUsage } from "@/lib/ai/usage";

import { mcpToolsFor } from "@/lib/mcp/client";

import {
  mightUseTools,
  shouldThink,
  wantsFiles,
  wantsWebPage,
  wantsImage,
} from "@/lib/ai/think";

import { nextStreamed } from "@/lib/ai/stream";

import {
  flattenToolMessages,
  friendlyModelError,
  isToolError,
} from "@/lib/ai/errors";

import {
  collectUrls,
  keepKnownLinks,
} from "@/lib/ai/links";

import { allows, planHere } from "@/lib/plans";

import {
  getTool,
  runTool,
  specsFor,
} from "@/lib/ai/tools";


export const dynamic = "force-dynamic";
export const maxDuration = 300;


// How many tool calls the agent may chain
// before we stop and report back.

const MAX_STEPS = 6;

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


const ATTACHMENT_BUCKET = "attachments";


// Groq counts every tool schema against its 8K/min
// budget, and connected apps (MCP, GitHub, Google)
// can add many thousands of tokens - enough to have
// a plain message refused. Keep the tools that fit a
// budget, in order (built-in first, connected apps
// after), and drop the rest for this turn.

function fitToolBudget<T>(
  specs: T[],
  maxTokens: number
): T[] {
  const kept: T[] = [];
  let used = 0;

  for (const spec of specs) {
    const cost = Math.ceil(
      JSON.stringify(spec).length / 4
    );

    if (used + cost > maxTokens) {
      continue;
    }

    kept.push(spec);
    used += cost;
  }

  return kept;
}


// Download attached images from storage, shrink
// them so the request stays small (each still
// counts as ~2048 tokens to the model regardless),
// and return them as data URLs a vision model can
// read. An image that will not fetch or decode is
// skipped rather than failing the whole turn.

async function imageDataUrls(
  db: import("@supabase/supabase-js").SupabaseClient,
  files: {
    storage_path: string;
    mime: string | null;
  }[]
): Promise<string[]> {
  const urls: string[] = [];

  for (const file of files) {
    try {
      const { data, error } = await db.storage
        .from(ATTACHMENT_BUCKET)
        .download(file.storage_path);

      if (error || !data) {
        continue;
      }

      const input = Buffer.from(
        await data.arrayBuffer()
      );

      const sharp = (await import("sharp")).default;

      // Longest side to 1024 and re-encoded as
      // JPEG: enough to read, small on the wire,
      // well under the 20MB per-image limit.
      const output = await sharp(input)
        .rotate()
        .resize(1024, 1024, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 80 })
        .toBuffer();

      urls.push(
        `data:image/jpeg;base64,${output.toString(
          "base64"
        )}`
      );
    } catch {
      // Skip an image that would not decode.
    }
  }

  return urls;
}


// ==========================================
// POST
// ==========================================

export async function POST(request: Request) {

  let body: {
    messages?: unknown;
    projectId?: string;
    channelId?: string;
    projectName?: string;
    channelName?: string;
    temperature?: number;
    think?: boolean;
    useMemory?: boolean;
    useTools?: boolean;
    useWeb?: boolean;

    instructions?: string;
    approvals?: {
      tool: string;
      filename?: string | null;
    }[];
    attachmentIds?: string[];
  };

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid request body." },
      { status: 400 }
    );
  }

  const history = sanitiseHistory(body.messages);

  const latestUserMessage =
    [...history]
      .reverse()
      .find((message) => message.role === "user")
      ?.content ?? "";

  // The one before it, for a follow-up like "do it
  // however you like" after the agent asked a
  // question about a request.
  const previousUserMessage =
    [...history]
      .reverse()
      .filter((message) => message.role === "user")[1]
      ?.content ?? "";

  const projectId =
    typeof body.projectId === "string"
      ? body.projectId
      : "";

  // Memory is shared through Supabase now, so a
  // turn has to name a real project to have any.

  if (!uuidRegex.test(projectId)) {
    return Response.json(
      { error: "A valid projectId is required." },
      { status: 400 }
    );
  }

  const scope: Scope = {
    projectId,

    channelId:
      typeof body.channelId === "string" &&
      uuidRegex.test(body.channelId)
        ? body.channelId
        : null,
  };

  const db = await createClient();

  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    return Response.json(
      { error: "You must be logged in." },
      { status: 401 }
    );
  }

  // Approvals the user granted for this turn.
  // They are per call, not a standing
  // permission, and never come from the model.

  const approvals = Array.isArray(body.approvals)
    ? body.approvals
    : [];

  const useTools = body.useTools !== false;
  const useWeb = body.useWeb !== false;

  // File tools only when the message is about
  // files. See lib/ai/think.ts.
  const fileTools =
    useTools &&
    (wantsFiles(latestUserMessage) || wantsFiles(previousUserMessage));

  // Building a web page: the design brief comes into
  // the prompt, and on the free shared model most of the
  // request's room goes to the page (see contextLimits).
  const buildingPage =
    fileTools &&
    (wantsWebPage(latestUserMessage) || wantsWebPage(previousUserMessage));

  // The image generator only when the message reads
  // like a request for a picture.
  const imageTools =
    useTools && wantsImage(latestUserMessage);

  // Which model answers is settled further down,
  // once the channel's agent has been read. It is
  // the channel's decision, not the browser's -
  // an agent with one name, one set of
  // instructions and one memory should not answer
  // with a different model depending on who
  // spoke to it.

  // Only offer tools for accounts this person has
  // actually connected. Telling the model about a
  // spreadsheet it has no way to open produces a
  // confident attempt and a dead end.

  const { data: linked } = await db
    .from("connections")
    .select("provider")
    .eq("user_id", user.id);

  const connections = (linked ?? []).map(
    (row) => row.provider as string
  );

  // Apps connected over MCP, on a plan that
  // includes them. From the kept tool lists, so
  // no server is contacted until a tool is used.

  const apps = allows(
    await planHere({
      db,
      admin: adminClient() ?? db,
      userId: user.id,
      projectId,
    }),
    "apps"
  )
    ? await mcpToolsFor(db, user.id)
    : { specs: [], index: new Map() };
  const useMemory = body.useMemory !== false;
  const think = body.think === true;

  const temperature =
    typeof body.temperature === "number" &&
    body.temperature >= 0 &&
    body.temperature <= 2
      ? body.temperature
      : 0.7;


  // ----------------------------------------
  // ATTACHMENTS
  // ----------------------------------------
  //
  // Text was pulled out of these at upload time,
  // so this is a read rather than a parse. It
  // goes in front of the latest turn as context
  // the user handed over.

  const attachmentIds = (
    Array.isArray(body.attachmentIds)
      ? body.attachmentIds
      : []
  ).filter((id) => uuidRegex.test(id));

  let attachmentContext = "";

  // Images the vision model will actually see, as
  // data URLs. A turn that has any is routed to the
  // vision model further down, since the text
  // models cannot read one.
  let attachmentImages: string[] = [];

  if (attachmentIds.length > 0) {
    const { data: files } = await db
      .from("attachments")
      .select(
        "filename, kind, extracted_text, truncated, note, mime, storage_path"
      )
      .in("id", attachmentIds);

    const rows = files ?? [];

    // Documents go in as text; images go in as
    // pictures on the message, not as a "cannot
    // read" note.

    const parts = rows
      .filter((file) => file.kind !== "image")
      .map((file) => {
        if (!file.extracted_text) {
          return [
            `File: ${file.filename}`,
            `(${file.note ?? "No readable text."})`,
          ].join("\n");
        }

        return [
          `File: ${file.filename}`,
          file.truncated
            ? "(truncated - only the beginning is shown)"
            : null,
          "```",
          file.extracted_text,
          "```",
        ]
          .filter(Boolean)
          .join("\n");
      });

    // Up to three images - the vision model's limit,
    // and enough to stay under the per-minute token
    // cap once each is counted.
    const pictures = rows.filter(
      (file) =>
        file.kind === "image" && file.storage_path
    );

    attachmentImages = await imageDataUrls(
      db,
      pictures.slice(0, 3) as {
        storage_path: string;
        mime: string | null;
      }[]
    );

    if (parts.length > 0) {
      attachmentContext = [
        "The user attached the following to this message.",
        "",
        parts.join("\n\n"),
      ].join("\n");
    }
  }


  // ----------------------------------------
  // THE CHANNEL'S OWN AGENT
  // ----------------------------------------
  //
  // Each channel has its own agent, so #design
  // and #research answer differently without
  // anyone repeating themselves every message.
  // The user's own standing instructions still
  // win, and are applied after these.

  let channelInstructions = "";

  let channelModel: string | null = null;

  if (scope.channelId) {
    const { data: channelAgent } = await db
      .from("agents")
      .select("instructions, model")
      .eq("channel_id", scope.channelId)
      .maybeSingle();

    channelInstructions =
      channelAgent?.instructions?.trim() ?? "";

    channelModel =
      (channelAgent?.model as string | null) ||
      null;
  }

  // The channel first, then whatever this person
  // set as their own default - which covers a
  // conversation with no channel, and a channel
  // nobody has given a model of its own. Then the
  // machine, which is where everyone started.

  let personalModel: string | null = null;

  if (!channelModel) {
    const { data: profile } = await db
      .from("profiles")
      .select("default_model")
      .eq("id", user.id)
      .maybeSingle();

    personalModel =
      (profile?.default_model as
        | string
        | null) || null;
  }

  // A turn with images has to be answered by a
  // model that can see them - Cerebras's Qwen if the
  // server has that key, else Groq's, whatever was
  // otherwise chosen.
  const needsVision = attachmentImages.length > 0;

  const visionModel = groqKey()
    ? GROQ_VISION_MODEL
    : CEREBRAS_VISION_MODEL;

  // With nothing chosen, the top of the shared free
  // chain answers - Groq (reliable) first, then
  // Cerebras, then the local machine.
  const sharedDefault = groqKey()
    ? GROQ_DEFAULT_MODEL
    : cerebrasKey()
      ? CEREBRAS_DEFAULT_MODEL
      : DEFAULT_MODEL;

  const model =
    needsVision && (cerebrasKey() || groqKey())
      ? visionModel
      : channelModel ||
        personalModel ||
        sharedDefault;

  const answersLocally = isLocal(model);

  // Groq and Cerebras are the shared free providers.
  // The fallback chain spans both, and Groq's per-
  // minute cap is the tight one, so a request on
  // either is trimmed to fit Groq - every step in the
  // chain then works.
  const onSharedFree =
    serviceOf(model) === "groq" ||
    serviceOf(model) === "cerebras";


  // ----------------------------------------
  // BUILD THE PROMPT
  // ----------------------------------------

  // Groq's free tier caps tokens per minute (8K),
  // not window size, and refuses a request that is
  // over rather than truncating it. So when Groq
  // answers, memory and history are trimmed to fit
  // under that ceiling - leaving room for the tool
  // schemas and the reply. Other models keep the
  // full budget.

  const contextLimits =
    onSharedFree
      ? needsVision
        ? // Each image is ~2048 tokens, up to three,
          // so the text context is squeezed hard to
          // keep the whole request under 8K.
          {
            historyTokens: 500,
            maxFacts: 2,
            summaryTokens: 200,
          }
        : buildingPage
          ? // A page is 5-12K tokens of HTML. Of the 8K a
            // minute, history and memory get a sliver so
            // the page has room to be finished.
            {
              historyTokens: 600,
              maxFacts: 3,
              summaryTokens: 250,
            }
          : {
              historyTokens: 3000,
              maxFacts: 10,
              summaryTokens: 1200,
            }
      : undefined;

  const context = await buildContext({
    db,
    scope,
    projectName: body.projectName ?? null,
    channelName: body.channelName ?? null,
    limits: contextLimits,
    history: attachmentContext
      ? [
          ...history.slice(0, -1),
          {
            role: "user" as const,
            content: [
              attachmentContext,
              "",
              history[history.length - 1]
                ?.content ?? "",
            ].join("\n"),
          },
        ]
      : history,
    customInstructions: [
      channelInstructions,
      body.instructions?.trim() ?? "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    toolsAvailable: fileTools,
    webAvailable: useWeb,
    webPage: buildingPage ? { compact: onSharedFree } : undefined,
    useMemory,
  });

  // The tools offered this turn - the same at every
  // step. On Groq the list is capped so its schemas
  // plus the prompt stay under the per-minute limit:
  // the more the prompt already weighs, the less is
  // left for tools. Built-in tools come first, so a
  // long list of connected-app tools is what gets
  // dropped, not file or image generation.

  // A plainly conversational message gets no tools -
  // so the model cannot decide to call one, or invent
  // one the provider then refuses.
  const offerTools =
    useTools && mightUseTools(latestUserMessage);

  // Built-in tools (file, web, image generation) are
  // few and small, and are the ones a message usually
  // needs - so they are always kept. Connected-app
  // tools (GitHub, Google, MCP) are many and large,
  // so they are what the Groq budget trims, never the
  // image generator the user just asked for.
  const builtinTools = offerTools
    ? specsFor({
        files: fileTools,
        web: useWeb,
        images: imageTools,
        connections: [],
      })
    : [];

  // A tool with no name makes gpt-oss's template
  // refuse the whole request ("Tools should have a
  // name!") - some MCP servers expose one - so any
  // nameless tool is dropped here.
  const hasName = (spec: {
    function?: { name?: string };
  }) => Boolean(spec.function?.name);

  const appTools = offerTools
    ? [
        ...specsFor({
          files: false,
          web: false,
          images: false,
          connections,
        }),
        ...apps.specs,
      ].filter(hasName)
    : [];

  const tokensOf = (specs: typeof appTools) =>
    Math.ceil(
      specs.reduce(
        (sum, spec) =>
          sum + JSON.stringify(spec).length,
        0
      ) / 4
    );

  const promptTokensEst = Math.ceil(
    context.messages.reduce(
      (sum, message) => sum + message.content.length,
      0
    ) / 4
  );

  const keptAppTools =
    onSharedFree
      ? fitToolBudget(
          appTools,
          Math.max(
            0,
            5500 -
              promptTokensEst -
              tokensOf(builtinTools)
          )
        )
      : appTools;

  const turnTools = [
    ...builtinTools,
    ...keptAppTools,
  ].filter(hasName);


  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {

      let closed = false;

      function send(event: unknown) {
        if (closed) {
          return;
        }

        try {
          controller.enqueue(
            encoder.encode(
              JSON.stringify(event) + "\n"
            )
          );
        } catch {
          closed = true;
        }
      }

      function close() {
        if (closed) {
          return;
        }

        closed = true;

        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      }


      // Tell the client what it is talking to
      // before any tokens arrive.

      send({
        type: "meta",
        model,

        // So the view can say where this answer
        // is being produced. It is the one claim
        // the app makes about privacy, and it
        // stops being true the moment somebody
        // picks a hosted model.
        local: answersLocally,
        provider: serviceOf(model),
        memory: {
          facts: context.factCount,
          summary: context.hasSummary,
          historyTokens: context.tokensUsed,
        },
      });


      // Hang the images on the latest user turn, so
      // the vision model sees them alongside the
      // question they were sent with.
      if (attachmentImages.length > 0) {
        for (
          let i = context.messages.length - 1;
          i >= 0;
          i--
        ) {
          if (context.messages[i].role === "user") {
            context.messages[i] = {
              ...context.messages[i],
              images: attachmentImages,
            };
            break;
          }
        }
      }

      let messages: OllamaMessage[] = [
        ...context.messages,
      ];

      let answer = "";
      let createdFile: string | undefined;

      // Image markdown from the generator, shown to
      // the user directly at the end so it appears
      // whatever the model writes.
      const generatedImages: string[] = [];

      // Links the model may keep in its reply: every URL
      // a tool returns this turn, plus any the person
      // wrote themselves. Anything else it writes was
      // invented, and is taken out - but only on a turn
      // that actually searched the web.
      const knownUrls = new Set<string>();

      for (const message of context.messages) {
        if (message.role === "user") {
          for (const url of collectUrls(
            message.content
          )) {
            knownUrls.add(url);
          }
        }
      }

      let webSearched = false;

      // Saves the agent's reply as a message, once,
      // with the service role. user_id is null - the
      // agent has no account - and row level
      // security lets only the service role write
      // that, so a browser cannot forge one.

      let agentReplySaved = false;

      // The user message this reply answers, so replies
      // that stream back out of order can show what they
      // reply to. Computed once, below.
      let repliesTo: string | null = null;

      async function saveAgentReply(
        text: string,
        file?: string
      ) {
        if (agentReplySaved || !text.trim()) {
          return;
        }

        agentReplySaved = true;

        const writer = adminClient() as unknown as
          | import("@supabase/supabase-js").SupabaseClient
          | null;

        if (!writer) {
          console.error(
            "No service role key: the agent reply was not saved."
          );
          return;
        }

        const { error } = await writer
          .from("messages")
          .insert({
            project_id: projectId,
            channel_id: scope.channelId,
            user_id: null,
            role: "assistant",
            content: text,
            file: file ?? null,
            reply_to: repliesTo,
          });

        if (error) {
          // Before migration 0032 there is no reply_to
          // column; save the reply without the link
          // rather than losing it.
          if (
            error.code === "42703" ||
            error.code === "PGRST204"
          ) {
            await writer
              .from("messages")
              .insert({
                project_id: projectId,
                channel_id: scope.channelId,
                user_id: null,
                role: "assistant",
                content: text,
                file: file ?? null,
              });
          } else {
            console.error(
              "Could not save the agent reply:",
              error.message
            );
          }
        }
      }


      // Find the user message this turn answers, so the
      // saved reply can point at it. The browser saved it
      // before asking, so it is already in the table.
      if (latestUserMessage.trim()) {
        const found = await (
          scope.channelId
            ? db
                .from("messages")
                .select("id")
                .eq("channel_id", scope.channelId)
            : db
                .from("messages")
                .select("id")
                .is("channel_id", null)
        )
          .eq("project_id", projectId)
          .eq("role", "user")
          .eq("user_id", user.id)
          .eq("content", latestUserMessage)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        repliesTo = found.data?.id ?? null;
      }
      let usedTools = false;
      let blockedOnApproval = false;
      // Which account the last step charged,
      // and what actually answered - both settled
      // inside the loop and needed after it.

      let paidBy:
        | "you"
        | "project"
        | "server"
        | "local" = "local";

      let answeredWith = model;

      let toolCallCount = 0;

      let promptTokens = 0;
      let responseTokens = 0;

      const startedAt = Date.now();


      try {

        for (
          let step = 0;
          step < MAX_STEPS;
          step++
        ) {

          let stepContent = "";

          let toolCalls: ToolCall[] = [];

          // Everything streamed during this
          // step, so a later tool call can tell
          // the UI to throw the draft away.

          let streamedThisStep = false;

          // The visible text already sent.
          let sentThisStep = "";


          // The last step has no tools, so a turn
          // that spent its steps searching still
          // ends in an answer rather than "ran out
          // of steps".
          const stepMessages =
            step === MAX_STEPS - 1 && usedTools
              ? [
                  ...messages,
                  {
                    role: "user" as const,
                    content:
                      "(No more tools this turn. Using what the tools returned above, write the final answer to my request now.)",
                  },
                ]
              : messages;

          const stepTools =
            step < MAX_STEPS - 1 &&
            turnTools.length > 0
              ? turnTools
              : undefined;

          const callModel = (
            tools: typeof turnTools | undefined,
            msgs: typeof stepMessages = stepMessages
          ) =>
            streamFor(db, user.id, {
              // Whatever answered the step before,
              // so a model over its limit or unpaid
              // for is not re-tried every step.
              model: answeredWith,

              // Falls back to the project's shared
              // key when this person has none of
              // their own, read with the service
              // role because members may spend it
              // without seeing it.
              projectId,
              admin: adminClient(),

              // One cache per conversation, for providers
              // that route by it.
              cacheKey: `${projectId}:${scope.channelId ?? "project"}`,

              messages: msgs,
              tools,

              // Hidden thinking is written before
              // the first word, so only when shown
              // or the message looks like a tool
              // request. See lib/ai/think.ts.
              think: shouldThink({
                message: latestUserMessage,
                tools: Boolean(tools),
                showReasoning: think,
              }),

              options: { temperature },
              signal: request.signal,
            });

          let answered;

          try {
            answered = await callModel(stepTools);
          } catch (error) {
            // The model called a tool that was not
            // offered; answer the turn with no tools
            // rather than failing outright.
            if (
              stepTools &&
              isToolError(error)
            ) {
              console.log(
                "[chat] tool call rejected; retrying without tools"
              );

              // Flatten the tool call/result messages to
              // plain text, or gpt-oss's template fails
              // the same way when it renders them with no
              // tools defined.
              answered = await callModel(
                undefined,
                flattenToolMessages(stepMessages)
              );
            } else {
              throw error;
            }
          }

          // A hosted model with nothing to pay
          // with answers on the machine instead,
          // and the reply says so rather than
          // being quietly worse.

          // Carried out of the loop, since the
          // usage record is written after the
          // last step rather than inside one.

          paidBy = answered.paidBy ?? "local";
          answeredWith = answered.model;

          if (answered.fellBack) {
            send({
              type: "meta",
              model: answered.model,
              local: isLocal(answered.model),
              fellBack: true,
              reason: answered.reason,
              from: answered.from,
            });
          }

          // Answering on the machine while it is
          // already busy means waiting in line.
          // Said, rather than a blank minute.

          const ahead =
            answered.paidBy == null ? localBusy() : 0;

          if (ahead > 0) {
            send({
              type: "status",
              text:
                ahead === 1
                  ? "The AI is finishing another request, yours is next"
                  : `The AI is busy with ${ahead} other requests, yours starts after them`,
            });
          }

          // Reading one model's stream to the end,
          // updating this step's state and streaming
          // tokens as they arrive. Pulled out so it can
          // be run again on a different stream if the
          // first one fails before showing anything.

          const drain = async (
            source: Awaited<ReturnType<typeof callModel>>
          ) => {
            for await (const chunk of source.stream) {

              const part = chunk.message;

              if (part?.thinking && think) {
                send({
                  type: "thinking",
                  text: part.thinking,
                });
              }

              if (part?.content) {
                stepContent += part.content;

                // Only what is new since the last
                // send, spaces included. See
                // lib/ai/stream.ts.

                const next = nextStreamed(sentThisStep, stepContent);

                sentThisStep = next.sent;

                if (next.reset) {
                  streamedThisStep = true;

                  send({ type: "reset" });
                }

                if (next.text) {
                  streamedThisStep = true;

                  send({ type: "token", text: next.text });
                }
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

                responseTokens +=
                  chunk.eval_count ?? 0;
              }
            }
          };

          try {
            await drain(answered);
          } catch (streamError) {
            // gpt-oss on Groq sometimes emits a built-in
            // tool call even when no tools were offered,
            // and the provider rejects the whole turn
            // ("Tool choice is none, but model called a
            // tool"). That error arrives mid-stream, past
            // the setup retry above. If nothing has
            // reached the screen yet, answer the step
            // again with no tools and a flattened history
            // - the same backstop - rather than sinking
            // the turn.
            const nothingShown =
              !streamedThisStep &&
              stepContent === "" &&
              toolCalls.length === 0;

            if (
              isToolError(streamError) &&
              nothingShown
            ) {
              console.log(
                "[chat] stream rejected the tools; retrying without them"
              );

              const retry = await callModel(
                undefined,
                flattenToolMessages(stepMessages)
              );

              paidBy = retry.paidBy ?? "local";
              answeredWith = retry.model;

              await drain(retry);
            } else {
              throw streamError;
            }
          }


          // ------------------------------------
          // NO TOOLS: THIS IS THE ANSWER
          // ------------------------------------

          if (toolCalls.length === 0) {
            answer = stripThinking(stepContent);

            // The stripped text can differ from
            // what we streamed (stray think
            // tags), so re-sync the client.

            if (!streamedThisStep && answer) {
              send({
                type: "token",
                text: answer,
              });
            }

            break;
          }


          // ------------------------------------
          // TOOL CALLS
          // ------------------------------------

          usedTools = true;

          toolCallCount += toolCalls.length;

          // Whatever was streamed before a tool
          // call was the model thinking out
          // loud, not the final reply.

          if (streamedThisStep) {
            send({ type: "reset" });
          }

          messages = [
            ...messages,
            {
              role: "assistant",
              content: stepContent,
              tool_calls: toolCalls,
            },
          ];

          for (const call of toolCalls) {
            const name = call.function?.name ?? "";

            const args =
              (call.function?.arguments ??
                {}) as Record<string, string>;

            const key = `${name}:${
              args.filename ?? ""
            }`;

            const definition = getTool(name);

            const app = apps.index.get(name);

            // Show the running label before the
            // work starts, so the UI has
            // something during a slow tool.

            send({
              type: "activity",
              text: key,
              label:
                definition?.runningLabel(args) ??
                app?.label ??
                `Running ${name}`,
              status: "working",
            });

            // Approval is granted per call from
            // the client, and only for the tool
            // and file it actually named.

            const approved =
              approvals.some(
                (grant) =>
                  grant.tool === name &&
                  (grant.filename ?? "") ===
                    (args.filename ?? "")
              );

            const outcome = await runTool(
              name,
              args,

              // Whose accounts a connected tool
              // may reach into. Never inferred -
              // it is always the person who sent
              // the message.
              {
                approved,
                userId: user.id,
                db,
                mcp: apps.index,

                // Files belong to the project this
                // conversation is in, and only it.
                projectId,
              }
            );

            send({
              type: "activity",
              text: key,
              label: outcome.doneLabel,
              status: outcome.needsApproval
                ? "blocked"
                : outcome.ok
                  ? "done"
                  : "failed",
            });

            if (outcome.needsApproval) {
              send({
                type: "approval",
                tool: name,
                filename: args.filename ?? null,
                label:
                  definition?.runningLabel(args) ??
                  app?.label ??
                  `Run ${name}`,
              });

              blockedOnApproval = true;
            }

            if (outcome.createdFile) {
              createdFile = outcome.createdFile;
            }

            // A generated image is shown to the user
            // by the route, not by the model - so the
            // model gets a short note, and the actual
            // picture is appended to the reply below.

            const madeImage =
              name === "generate_image" &&
              outcome.ok;

            if (madeImage) {
              generatedImages.push(outcome.result);
            }

            // Remember every real URL this tool returned,
            // and note when the web itself was used - the
            // link filter only runs then.
            for (const url of collectUrls(
              outcome.result
            )) {
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
                content: madeImage
                  ? "The image was created and is now shown to the user. Say in one short sentence what you made; do not repeat any link or markdown."
                  : outcome.result,
              },
            ];
          }
        }


        // --------------------------------------
        // OUT OF STEPS
        // --------------------------------------

        // On a web turn, keep only the links the search
        // or the page-reads actually returned; drop any
        // the model invented. Done before the image
        // markdown is added, so a real internal image
        // link is never touched.

        if (webSearched) {
          answer = keepKnownLinks(answer, knownUrls);
        }

        // Any generated images are shown to the user
        // now, appended to whatever the model wrote,
        // so the picture always appears.

        const imageMarkdown = generatedImages.join("\n\n");

        if (imageMarkdown) {
          const prefix = answer ? "\n\n" : "";

          send({
            type: "token",
            text: prefix + imageMarkdown,
          });

          answer = answer
            ? `${answer}\n\n${imageMarkdown}`
            : imageMarkdown;
        }

        if (!answer) {
          answer = blockedOnApproval
            ? "That needs your approval before I can run it."
            : usedTools
              ? "I ran the tools you asked for, but ran out of steps before writing a summary."
              : "The model returned an empty response. Try rephrasing the request.";

          send({ type: "token", text: answer });
        }


        const durationMs = Date.now() - startedAt;

        // The agent's reply is saved here, by the
        // server, not by the browser. The database
        // only takes an agent message from the
        // service role, so nobody can post a fake
        // "Agent" message by calling the database
        // directly. Best effort: a reply on screen
        // that failed to save is better than an
        // error over one the person already read.

        await saveAgentReply(answer, createdFile);

        send({
          type: "complete",
          message: answer,
          file: createdFile,
          usage: {
            promptTokens,
            responseTokens,
            ms: durationMs,
            model,
          },
        });

        close();

        await recordUsage(db, {
          scope,
          userId: user.id,
          model: answeredWith,
          kind: "chat",

          // Whose account this turn was charged
          // to, which is what makes a shared key
          // accountable rather than a mystery.
          paidBy,

          promptTokens,
          responseTokens,
          durationMs,
          toolCalls: toolCallCount,
        });


        // --------------------------------------
        // BACKGROUND MEMORY
        // --------------------------------------
        //
        // Runs after the reply is on screen, so
        // remembering never costs the user
        // waiting time.

        if (useMemory && answer) {
          const remember = async () => {
            try {
              console.log(
                `[memory] updating ${projectId}`
              );


              await updateRollingSummary({
                db,
                scope,
                dropped: context.dropped,
              });

              // Reuse the id already found for the
              // reply link - it is the same message.

              await extractFacts({
                db,
                scope,
                userMessage: latestUserMessage,
                assistantMessage: answer,
                sourceMessageId: repliesTo,
              });

              console.log(
                `[memory] done ${projectId}`
              );
            } catch (error) {
              console.error(
                "Memory update failed:",
                error
              );
            }
          };

          // after() has to be reached inside the
          // request scope. This runs once the
          // stream is already closed, so fall
          // back to running the work directly
          // rather than losing the memory write.

          try {
            after(remember);
          } catch {
            void remember();
          }
        }

      } catch (error) {

        // The user pressed stop, or navigated
        // away. Not an error worth showing.

        if (
          error instanceof Error &&
          (error.name === "AbortError" ||
            request.signal.aborted)
        ) {
          await saveAgentReply(answer, createdFile);

          send({
            type: "complete",
            message: answer,
            file: createdFile,
            stopped: true,
          });

          close();

          return;
        }

        // An image was already made this turn, but a
        // later step failed. Show the picture rather
        // than only an error - the work is done and
        // stored.
        if (generatedImages.length > 0) {
          const imageMarkdown =
            generatedImages.join("\n\n");

          send({ type: "token", text: imageMarkdown });

          answer = answer
            ? `${answer}\n\n${imageMarkdown}`
            : imageMarkdown;

          await saveAgentReply(answer, createdFile);

          send({
            type: "complete",
            message: answer,
            file: createdFile,
          });

          close();

          return;
        }

        console.error("Chat route error:", error);

        // Worth waking somebody for when it is
        // Teamski's fault: the built-in AI gone,
        // or a bug. Not when it is the person's -
        // today's allowance used up - or a hosted
        // provider refusing their key, which has an
        // HTTP status and says so to them.

        const providerSaidNo =
          typeof (error as { status?: unknown } | null)?.status === "number";

        const theirLimit =
          error instanceof Error && error.name === "DailyLimitError";

        if (!providerSaidNo && !theirLimit) {
          await raiseAlert("web", {
            key:
              error instanceof OllamaUnreachableError
                ? "ai-down"
                : "chat-error",
            title:
              error instanceof OllamaUnreachableError
                ? "The built-in AI is not answering chat messages"
                : "A chat message failed with a server error",
            detail: describeError(error),
          });
        }

        send({
          type: "error",

          // One plain sentence for the person; the raw
          // error already went to the log and the alert
          // above. Ollama being down keeps its own
          // message and the offline flag the UI reads.
          message:
            error instanceof OllamaUnreachableError
              ? error.message
              : friendlyModelError(error),

          offline:
            error instanceof
            OllamaUnreachableError,
        });

        close();
      }
    },
  });


  return new Response(stream, {
    headers: {
      "Content-Type":
        "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
