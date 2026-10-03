import type { SupabaseClient } from "@supabase/supabase-js";

import {
  NUM_CTX,
  completeJson,
  embed,
  estimateTokens,
  stripThinking,
  type OllamaMessage,
} from "./ollama.ts";

import {
  blindIndex,
  openSecret,
  sealSecret,
} from "../crypto/secrets.ts";


// ==========================================
// CONVERSATION MEMORY
// ==========================================
//
// The model only sees what we hand it, so this
// file decides what "remembering" means:
//
//   1. Working memory - the most recent turns,
//      trimmed to fit a token budget.
//
//   2. Episodic memory - a rolling summary of
//      the turns that fell out of the window.
//
//   3. Semantic memory - durable facts pulled
//      out of the conversation and injected
//      into every later prompt.
//
// All three live in Supabase, scoped to a
// project and channel, so every teammate in a
// project talks to an agent that remembers the
// same things.
//

export type Db = SupabaseClient;

export type Scope = {
  projectId: string;
  channelId: string | null;
};

export type StoredMessage = {
  role: "user" | "assistant";
  content: string;
};

export type MemoryFact = {
  id: string;
  content: string;
  source: string;
  created_at: string;

  // True for a fact from the project's shared memory,
  // read by every channel's agent.
  shared?: boolean;
};


// ==========================================
// SHARED PROJECT MEMORY
// ==========================================
//
// Each channel's agent keeps its own memory, so research
// notes stay out of the pitch writer's way. On top of
// that sits one shared memory for the whole project -
// the rows with no channel - holding what every channel
// needs: the brief, the goal, the stack, deadlines, who
// does what, decisions the team made. A decision made in
// #ideas is then known in #build, and a brief is loaded
// once rather than pasted into every channel.
//
// Nothing private lands there: direct messages never
// reach an agent, and only project conversations (a
// channel, or the project with no channel) write memory.
//

export function projectScope(scope: Scope): Scope {
  return { projectId: scope.projectId, channelId: null };
}


// Someone asking, in words, for a thing to be remembered
// for everyone - "remember for the whole project that we
// use Supabase", "note for the team: demo is Friday".

const REMEMBER = /\b(remember|note|save|keep in mind|don'?t forget|memori[sz]e)\b/i;
const FOR_EVERYONE =
  /\b(for|across|to)\s+(the\s+)?(whole|entire|all|every|full)?\s*(project|team|channels?|everyone|everybody)\b/i;

export function asksForProjectMemory(text: string) {
  return REMEMBER.test(text) && FOR_EVERYONE.test(text);
}


// The facts one channel's agent sees: the project's
// shared facts first (the ones every channel relies on),
// then the channel's own, the same fact never twice, and
// no more than `max` in all.

export function mergeFacts(
  shared: MemoryFact[],
  own: MemoryFact[],
  max: number
): MemoryFact[] {
  const key = (fact: MemoryFact) => fact.content.trim().toLowerCase();

  const sharedFacts = shared
    .slice(0, max)
    .map((fact) => ({ ...fact, shared: true }));

  const seen = new Set(sharedFacts.map(key));

  const ownFacts = own
    .filter((fact) => !seen.has(key(fact)))
    .map((fact) => ({ ...fact, shared: false }));

  return [...sharedFacts, ...ownFacts].slice(0, max);
}


// How much of the context window we spend on
// recent turns.
//
// The rest pays for the system prompt, the tool
// schemas and the reply itself, which together
// run to well over a thousand tokens. A fixed
// budget silently overflowed a smaller window,
// so derive it from the window we actually get.

const HISTORY_TOKEN_BUDGET = Math.max(
  800,
  Math.floor(NUM_CTX * 0.4)
);

// Always keep at least this many recent turns,
// even if they are long.

const MIN_RECENT_MESSAGES = 4;

// Summarise once this many messages have
// dropped out of the window.

const SUMMARY_TRIGGER = 6;


// ==========================================
// SCOPE FILTER
// ==========================================
//
// channel_id is nullable, and `eq` cannot match
// null, so the two cases need different filters.
//

function scoped<T extends { eq: unknown; is: unknown }>(
  query: T,
  scope: Scope
): T {
  const builder = query as unknown as {
    eq: (column: string, value: string) => T;
    is: (column: string, value: null) => T;
  };

  const byProject = builder.eq(
    "project_id",
    scope.projectId
  );

  const next = byProject as unknown as {
    eq: (column: string, value: string) => T;
    is: (column: string, value: null) => T;
  };

  return scope.channelId
    ? next.eq("channel_id", scope.channelId)
    : next.is("channel_id", null);
}


// ==========================================
// SUMMARY STORAGE
// ==========================================

export async function getSummary(
  db: Db,
  scope: Scope
) {
  const { data, error } = await scoped(
    db
      .from("conversation_summaries")
      .select("summary, covered_count"),
    scope
  ).maybeSingle();

  if (error) {
    console.error(
      "Failed to read summary:",
      error.message
    );
  }

  return {
    // Stored sealed; openSecret passes plaintext
    // (rows written before sealing) straight through.
    summary: openSecret(data?.summary) ?? "",
    covered_count: data?.covered_count ?? 0,
  };
}


export async function saveSummary(
  db: Db,
  scope: Scope,
  summary: string,
  coveredCount: number
) {
  // No composite unique constraint to upsert
  // against (the uniqueness is two partial
  // indexes), so update first and insert only
  // when there was nothing to update.

  // Sealed at rest, like the facts. The value going in
  // is plaintext from the summariser; it is opened again
  // in getSummary before it reaches a prompt.
  const sealedSummary = sealSecret(summary);

  const { data: updated, error: updateError } =
    await scoped(
      db
        .from("conversation_summaries")
        .update({
          summary: sealedSummary,
          covered_count: coveredCount,
          updated_at: new Date().toISOString(),
        }),
      scope
    ).select("id");

  if (updateError) {
    console.error(
      "Failed to update summary:",
      updateError.message
    );

    return;
  }

  if (updated && updated.length > 0) {
    return;
  }

  const { error: insertError } = await db
    .from("conversation_summaries")
    .insert({
      project_id: scope.projectId,
      channel_id: scope.channelId,
      summary: sealedSummary,
      covered_count: coveredCount,
    });

  if (insertError) {
    console.error(
      "Failed to insert summary:",
      insertError.message
    );
  }
}


// ==========================================
// FACT STORAGE
// ==========================================

export async function getFacts(
  db: Db,
  scope: Scope,
  limit = 40
): Promise<MemoryFact[]> {
  const { data, error } = await scoped(
    db
      .from("memory_facts")
      .select("id, content, source, created_at"),
    scope
  )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(
      "Failed to read facts:",
      error.message
    );

    return [];
  }

  // content is sealed at rest; open it before it goes
  // anywhere. openSecret returns plaintext untouched, so
  // facts written before sealing still read correctly.
  return (data ?? []).map((row) => ({
    ...(row as MemoryFact),
    content:
      openSecret((row as MemoryFact).content) ?? "",
  })) as MemoryFact[];
}


// The facts closest in meaning to what was just
// asked, rather than simply the newest. Falls back
// to recency whenever the semantic path is not
// available - no embedder, no vectors yet, or an
// error - and always tops up from recent facts so a
// fact written before embeddings existed still
// surfaces. Never throws: memory degrades, it does
// not break the turn.

export async function getRelevantFacts(
  db: Db,
  scope: Scope,
  query: string,
  limit: number
): Promise<MemoryFact[]> {
  const recent = await getFacts(db, scope, limit);

  // Fewer facts than would be injected anyway: there
  // is nothing to narrow down, so skip the embedding
  // round-trip. This is the common early case, so
  // most turns pay nothing for semantic memory.
  if (recent.length < limit) {
    return recent;
  }

  const vector = query.trim()
    ? await embed(query)
    : null;

  if (!vector) {
    return recent;
  }

  const { data, error } = await db.rpc(
    "match_memory_facts",
    {
      query_embedding: vector,
      p_project_id: scope.projectId,
      p_channel_id: scope.channelId,
      match_count: limit,
    }
  );

  if (error || !Array.isArray(data) || data.length === 0) {
    // RPC missing (migration not run) or nothing
    // embedded yet: recency stands in.
    return recent;
  }

  // The RPC returns content straight from the column,
  // so it arrives sealed - open it here (recent facts
  // came through getFacts already decrypted).
  const matched = (data as MemoryFact[]).map(
    (fact) => ({
      ...fact,
      content: openSecret(fact.content) ?? "",
    })
  );

  // Best matches first, then recent facts to fill
  // any remaining slots (covering facts not yet
  // embedded), deduped by id and capped at limit.

  const seen = new Set(matched.map((fact) => fact.id));

  const merged = [...matched];

  for (const fact of recent) {
    if (merged.length >= limit) {
      break;
    }

    if (!seen.has(fact.id)) {
      merged.push(fact);
      seen.add(fact.id);
    }
  }

  return merged.slice(0, limit);
}


export async function addFacts(
  db: Db,
  scope: Scope,
  contents: string[],
  source: "auto" | "user" = "auto",
  createdBy: string | null = null,

  // The message the fact was learned from, so
  // deleting that message forgets it too.
  sourceMessageId: string | null = null
) {
  const cleaned = contents
    .map((content) => content.trim())
    .filter(Boolean);

  if (cleaned.length === 0) {
    return;
  }

  // A vector per fact so it can later be found by
  // meaning. Embedded from the PLAINTEXT (before
  // sealing) and in parallel; a null (embedder down or
  // model not pulled) just stores the fact without one,
  // and it still surfaces by recency until re-embedded.

  const vectors = await Promise.all(
    cleaned.map((content) => embed(content))
  );

  // content is sealed at rest, so the unique index that
  // dedupes facts moves onto content_hash - a keyed
  // fingerprint of the plaintext, stable across seals
  // (each seal uses a fresh IV, so the ciphertext is
  // not). Both are derived from the same plaintext here.

  const build = (opts: {
    seal: boolean;
    embedding: boolean;
    sourceMessage: boolean;
  }) =>
    cleaned.map((content, index) => {
      const row: Record<string, unknown> = {
        project_id: scope.projectId,
        channel_id: scope.channelId,
        content: opts.seal
          ? sealSecret(content)
          : content,
        source,
        created_by: createdBy,
      };

      // The fingerprint rides with the sealed content;
      // when we fall back to plaintext (an un-migrated
      // database) the old content-based index dedupes
      // instead, so it is left off.
      if (opts.seal) {
        row.content_hash = blindIndex(content);
      }

      if (opts.sourceMessage) {
        row.source_message_id = sourceMessageId;
      }

      if (opts.embedding) {
        row.embedding = vectors[index];
      }

      return row;
    });

  const missingColumn = (cause: {
    code?: string;
  } | null) =>
    Boolean(
      cause &&
        (cause.code === "42703" ||
          cause.code === "PGRST204")
    );

  // A duplicate fact is not an error worth
  // surfacing - it just means we already knew it.

  let { error } = await db
    .from("memory_facts")
    .upsert(
      build({
        seal: true,
        embedding: true,
        sourceMessage: true,
      }),
      { ignoreDuplicates: true }
    );

  // content_hash arrives with 0031. Where it is missing
  // the column is not there yet, so store the plaintext
  // and let the old content-based index dedupe. Then
  // peel the other newer columns as before: embedding
  // (0028), source_message_id (0018). Remembering
  // without them beats not remembering.

  if (missingColumn(error)) {
    ({ error } = await db
      .from("memory_facts")
      .upsert(
        build({
          seal: false,
          embedding: true,
          sourceMessage: true,
        }),
        { ignoreDuplicates: true }
      ));
  }

  if (missingColumn(error)) {
    ({ error } = await db
      .from("memory_facts")
      .upsert(
        build({
          seal: false,
          embedding: false,
          sourceMessage: true,
        }),
        { ignoreDuplicates: true }
      ));
  }

  if (missingColumn(error)) {
    ({ error } = await db
      .from("memory_facts")
      .upsert(
        build({
          seal: false,
          embedding: false,
          sourceMessage: false,
        }),
        { ignoreDuplicates: true }
      ));
  }

  if (error && error.code !== "23505") {
    console.error(
      "Failed to save facts:",
      error.message
    );
  }
}


export async function deleteFact(
  db: Db,
  scope: Scope,
  id: string
) {
  const { error } = await scoped(
    db.from("memory_facts").delete(),
    scope
  ).eq("id", id);

  if (error) {
    console.error(
      "Failed to delete fact:",
      error.message
    );
  }
}


export async function clearMemory(
  db: Db,
  scope: Scope
) {
  const facts = await scoped(
    db.from("memory_facts").delete(),
    scope
  );

  if (facts.error) {
    console.error(
      "Failed to clear facts:",
      facts.error.message
    );
  }

  const summary = await scoped(
    db.from("conversation_summaries").delete(),
    scope
  );

  if (summary.error) {
    console.error(
      "Failed to clear summary:",
      summary.error.message
    );
  }
}


// ==========================================
// FORGET A MESSAGE
// ==========================================
//
// Called when a message is deleted or rewritten.
// Facts learned from it go - for a user message
// the database cascade already did that, and for
// an agent reply they belong to the question it
// answered. The rolling summary cannot be
// unpicked sentence by sentence, so it is dropped
// and rebuilt from the history that remains.
//

export async function forgetMessage(
  db: Db,
  message: {
    id: string;
    role: string;
    project_id: string;
    channel_id: string | null;
    created_at: string;
  }
) {
  const scope: Scope = {
    projectId: message.project_id,
    channelId: message.channel_id,
  };

  let sourceId: string | null = message.id;

  if (message.role === "assistant") {
    const { data: asked } = await scoped(
      db
        .from("messages")
        .select("id")
        .eq("role", "user")
        .lt("created_at", message.created_at),
      scope
    )
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    sourceId = asked?.id ?? null;
  }

  if (sourceId) {
    const { error } = await db
      .from("memory_facts")
      .delete()
      .eq("source_message_id", sourceId);

    if (
      error &&
      error.code !== "42703" &&
      error.code !== "PGRST204"
    ) {
      console.error(
        "Failed to forget facts:",
        error.message
      );
    }
  }

  const { error: summaryError } = await scoped(
    db.from("conversation_summaries").delete(),
    scope
  );

  if (summaryError) {
    console.error(
      "Failed to drop summary:",
      summaryError.message
    );
  }
}


// ==========================================
// SANITISE HISTORY
// ==========================================
//
// The browser sends UI-shaped messages that
// carry ids, activity trails and file badges.
// None of that belongs in the model prompt.
//

export function sanitiseHistory(
  raw: unknown
): StoredMessage[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const cleaned: StoredMessage[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const candidate = entry as {
      role?: unknown;
      content?: unknown;
    };

    const role =
      candidate.role === "assistant"
        ? "assistant"
        : candidate.role === "user"
          ? "user"
          : null;

    if (!role) {
      continue;
    }

    const content =
      typeof candidate.content === "string"
        ? stripThinking(candidate.content)
        : "";

    if (!content.trim()) {
      continue;
    }

    cleaned.push({ role, content });
  }

  return cleaned;
}


// ==========================================
// FIT HISTORY TO THE CONTEXT WINDOW
// ==========================================
//
// Walks backwards from the newest message and
// keeps whatever fits the budget. Returns both
// the kept messages and the ones that were
// dropped, so the dropped ones can be folded
// into the rolling summary.
//

// Trim a block of text to a token ceiling, keeping
// the end (the most recent, for a rolling summary).
// Undefined ceiling means keep all of it.

function capTokens(
  text: string,
  maxTokens?: number
) {
  if (!maxTokens || !text) {
    return text;
  }

  if (estimateTokens(text) <= maxTokens) {
    return text;
  }

  // ~4 characters a token, and a mark so the model
  // knows the front was cut.
  return "…" + text.slice(-(maxTokens * 4));
}


export function windowHistory(
  history: StoredMessage[],
  budget = HISTORY_TOKEN_BUDGET
) {
  const kept: StoredMessage[] = [];

  let used = 0;

  for (
    let index = history.length - 1;
    index >= 0;
    index--
  ) {
    const message = history[index];

    const cost =
      estimateTokens(message.content) + 8;

    const isProtected =
      kept.length < MIN_RECENT_MESSAGES;

    if (!isProtected && used + cost > budget) {
      break;
    }

    kept.unshift(message);

    used += cost;
  }

  return {
    kept,

    dropped: history.slice(
      0,
      history.length - kept.length
    ),

    tokensUsed: used,
  };
}


// ==========================================
// BUILD THE SYSTEM PROMPT
// ==========================================

export function buildSystemPrompt(options: {
  projectName?: string | null;
  channelName?: string | null;
  summary: string;
  facts: MemoryFact[];
  customInstructions?: string;
  toolsAvailable: boolean;
  webAvailable?: boolean;

  // Building a web page this turn: add the design brief.
  // "compact" when the model's room is tight (the free
  // shared key), so it writes tighter CSS.
  webPage?: { compact: boolean };
}) {
  const parts: string[] = [];

  parts.push(
    [
      "You are the assistant inside Teamski, a collaborative workspace where teams work with AI agents.",
      "",
      "How to answer:",
      "- Reply directly to the user's latest message.",
      "- Use Markdown: headings, lists, tables and fenced code blocks with a language tag.",
      "- For a line break, start a new line or leave a blank line. Never write HTML tags like <br>.",
      "- Never show your reasoning, planning or internal analysis. Give the answer itself.",
      '- Do not announce what you are about to do ("I will divide...", "Let me...") or explain how you worked it out. Start with the result.',
      "- Do not mention files, file names, tools or searches unless the user asked about them. Use what they returned without describing them.",
      '- Never open with filler like "Sure!" or "Great question". Start with the substance.',
      "- If you do not know something, say so plainly instead of inventing it.",
      "- Never invent testimonials, reviews, customer names, client logos, statistics or awards and present them as real - not even in sample content. Where a page needs them, leave a clearly marked placeholder like [Customer quote] for the team to fill in.",
      "- Links: only give a URL you actually have - one from a web search or a page you opened this turn, or one the user gave you. Copy it exactly, character for character. Never invent, guess, shorten or complete a URL, and never build one from a site name. If you do not have a real link for something, do not write one - offer to look it up instead. A made-up link is worse than no link.",
      "- To share a source, search for it first, then link the exact result. Do not link a page you have not seen.",
      "- You can generate images, read attached images and documents, search the web, and use the team's connected apps - when the user asks. Never tell the user to use another service like DALL-E, Midjourney or ChatGPT for these; you do them here.",
    ].join("\n")
  );

  if (options.toolsAvailable) {
    parts.push(
      [
        "Tools:",
        "- You can create, read, edit, delete and list files that belong to this project.",
        "- After a tool runs, tell the user what changed in one or two sentences.",

        "",
        "When NOT to use a tool:",
        "- Only touch a file when the user asks you to, in words, in their latest message - or in the one just before it, when their latest message answers a question you asked about that request.",
        "- Look for an instruction like create, write, save, make, read, open, show, edit, update, change, delete or list.",
        "- Without one of those, reply in conversation and call no tool at all.",
        "- Someone telling you something about themselves is not a request to write it down. You remember things automatically; you do not need a file for it.",
        "",
        "Examples:",
        'User: "my favourite number is 7" -> no tool. Reply in conversation.',
        'User: "I work in marketing" -> no tool. Reply in conversation.',
        'User: "what do you think of this plan?" -> no tool. Reply in conversation.',
        'User: "save that to notes.md" -> create_file.',
        'User: "build me a landing page for a bakery" -> create_file landing.html, then one short sentence.',
        'User: "what files are there?" -> list_files.',
      ].join("\n")
    );
  }

  if (options.webPage && options.toolsAvailable) {
    parts.push(
      [
        "Building a web page - this is the quality bar:",
        "- Save it with create_file as ONE complete, self-contained .html file (CSS in a <style> tag, JavaScript inline). Never paste the code into the chat; the team previews the file in the chat. To change an existing page, edit that same file.",
        "- Don't ask about tone, colours or sections first. Make strong choices, build it, then offer to adjust.",
        "- Sections: a sticky nav (name + 3-4 links + a button); a hero with a bold headline, a one-line subhead, a primary and a secondary button and a visual; 3-6 feature cards with inline SVG icons; how it works (3 steps); offerings or pricing; an FAQ using <details>; a closing call-to-action band; a footer.",
        "- Design: a palette that fits the business (one main colour, one accent, neutrals) as CSS variables; two Google Fonts (a characterful display font for headings, a clean sans for text); generous spacing and a centred max-width container; rounded corners, soft layered shadows, subtle gradient backgrounds; hover states on buttons and cards; a gentle fade-in on scroll with IntersectionObserver.",
        "- Responsive: grid and flex, mobile-first media queries; nothing overflows on a 375px phone.",
        "- Visuals: no image files (they won't exist). Use inline SVG illustrations and icons, CSS shapes, gradients and emoji.",
        "- Copy: specific to this business, benefit-led, no lorem ipsum. Never invent testimonials, reviews, customer names, stats, awards or logos - use clearly marked placeholders like [Customer quote].",
        options.webPage.compact
          ? "- Room is limited: keep the CSS compact (variables, shared classes, no repetition) so the whole page fits, and finish the file - a page cut off half-way is worse than a shorter complete one."
          : "- Write the whole page; don't stop half-way.",
        "- After saving, reply with one or two sentences: what you built and what they could ask you to change.",
      ].join("\n")
    );
  }

  const place = [
    options.projectName,
    options.channelName
      ? `#${options.channelName}`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  if (place) {
    parts.push(`You are in: ${place}.`);
  }

  // A channel is shared by a team, so more than one
  // person is talking to the same agent. Handle
  // conflicting instructions like a good teammate would:
  // surface the conflict and let the team decide, rather
  // than silently following whoever spoke last.
  if (options.channelName) {
    parts.push(
      [
        "You are in a shared channel with more than one person, all talking to you.",
        "If recent messages give you conflicting instructions (for example one person says use React and another says use Vue), do not silently pick one or just follow the latest.",
        "Name the conflict in one short line, say who asked for what, and ask the team which to follow before acting on it.",
      ].join("\n")
    );
  }

  if (options.summary.trim()) {
    parts.push(
      [
        "Summary of earlier conversation (older turns, condensed):",
        options.summary.trim(),
      ].join("\n")
    );
  }

  // In a channel, memory comes in two layers: what the
  // whole project shares with every channel, and what
  // this channel has learned. Outside a channel it is
  // all project memory, as before.
  const shared = options.facts.filter((fact) => fact.shared);
  const own = options.facts.filter((fact) => !fact.shared);

  if (options.channelName && shared.length > 0) {
    parts.push(
      [
        "Shared memory for the whole project (every channel's agent knows these - the brief, goals, decisions, deadlines):",
        ...shared.map((fact) => `- ${fact.content}`),
      ].join("\n")
    );
  }

  if (own.length > 0 || (!options.channelName && shared.length > 0)) {
    const list = options.channelName ? own : options.facts;

    parts.push(
      [
        options.channelName
          ? `What you remember from #${options.channelName}:`
          : "Things you remember about this project and the people in it:",
        ...list.map((fact) => `- ${fact.content}`),
      ].join("\n")
    );
  }

  if (options.facts.length > 0) {
    parts.push("Use what you remember naturally. Do not list it back unless asked.");
  }

  if (options.channelName) {
    parts.push(
      "When someone asks you to remember something for the whole project or team, it is saved to the shared memory every channel's agent reads - confirm that in a few words. Big team decisions, the brief, deadlines and roles are shared automatically."
    );
  }

  if (options.customInstructions?.trim()) {
    parts.push(
      [
        "The user's own standing instructions (these take priority):",
        options.customInstructions.trim(),
      ].join("\n")
    );
  }

  return parts.join("\n\n");
}


// ==========================================
// BUILD THE FULL PROMPT
// ==========================================

export async function buildContext(options: {
  db: Db;
  scope: Scope;
  projectName?: string | null;
  channelName?: string | null;
  history: StoredMessage[];
  customInstructions?: string;
  toolsAvailable: boolean;
  webAvailable?: boolean;
  webPage?: { compact: boolean };
  useMemory: boolean;

  // A per-request ceiling, for a model whose free
  // tier limits tokens per minute rather than the
  // window (Groq). Memory and history are trimmed
  // to fit so the request is not refused outright.
  // Absent, the full budget is used as before.
  limits?: {
    historyTokens?: number;
    maxFacts?: number;
    summaryTokens?: number;
  };
}) {
  const maxFacts = options.limits?.maxFacts ?? 25;

  // The latest user turn is what the facts should be
  // relevant to.
  const query =
    [...options.history]
      .reverse()
      .find((message) => message.role === "user")
      ?.content ?? "";

  // In a channel, the project's shared memory comes too,
  // with up to about 40% of the room: enough for the
  // brief and the big decisions, without crowding out
  // what this channel itself has learned.
  const inChannel = Boolean(options.scope.channelId);

  const sharedCap = inChannel
    ? Math.max(2, Math.ceil(maxFacts * 0.4))
    : 0;

  const [{ summary: fullSummary }, own, shared] =
    options.useMemory
      ? await Promise.all([
          getSummary(options.db, options.scope),
          getRelevantFacts(
            options.db,
            options.scope,
            query,
            maxFacts
          ),
          inChannel
            ? getRelevantFacts(
                options.db,
                projectScope(options.scope),
                query,
                sharedCap
              )
            : Promise.resolve([] as MemoryFact[]),
        ])
      : [{ summary: "" }, [] as MemoryFact[], [] as MemoryFact[]];

  const facts = mergeFacts(shared, own, maxFacts);

  // Keep the most recent part of the summary if it
  // is over the cap - the latest condensed turns
  // are the ones still worth carrying.
  const summary = capTokens(
    fullSummary,
    options.limits?.summaryTokens
  );

  const { kept, dropped, tokensUsed } =
    windowHistory(
      options.history,
      options.limits?.historyTokens
    );

  const systemPrompt = buildSystemPrompt({
    projectName: options.projectName,
    channelName: options.channelName,
    summary,
    facts,
    customInstructions:
      options.customInstructions,
    toolsAvailable: options.toolsAvailable,
    webAvailable: options.webAvailable,
    webPage: options.webPage,
  });

  const messages: OllamaMessage[] = [
    {
      role: "system",
      content: systemPrompt,
    },

    ...kept.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];

  // A hard ceiling for a token-per-minute model
  // (Groq). windowHistory keeps the most recent few
  // turns whatever their size, so one fat pasted
  // message can blow the request past the limit and
  // be refused. This guarantees the assembled prompt
  // fits, whatever a single message weighs, by
  // trimming over-long past turns, then dropping the
  // oldest, then shortening the system prompt's tail
  // (its memory) as a last resort.

  if (options.limits) {
    // Estimated tokens; the real count runs a little
    // higher, and the tool schemas and reply also
    // draw on the same per-minute budget, so this
    // sits well under the 8K limit.
    const CEILING = 5000;

    const cost = (message: OllamaMessage) =>
      estimateTokens(message.content) + 8;

    // No single past turn (not the system prompt,
    // not the newest message) may dominate.
    const newest = messages.length - 1;

    for (let i = 1; i < newest; i++) {
      if (cost(messages[i]) > 1200) {
        messages[i] = {
          ...messages[i],
          content:
            messages[i].content.slice(0, 1200 * 4) +
            " …",
        };
      }
    }

    let total = messages.reduce(
      (sum, message) => sum + cost(message),
      0
    );

    // Drop the oldest turns, always keeping the
    // system prompt and the newest message.
    while (total > CEILING && messages.length > 2) {
      total -= cost(messages[1]);
      messages.splice(1, 1);
    }

    // Still over: the system prompt itself is large.
    // Keep its head (the behaviour rules) and cut the
    // tail (the remembered facts and summary).
    if (total > CEILING && messages[0]) {
      const keep = Math.max(
        1600,
        messages[0].content.length -
          (total - CEILING) * 4
      );

      if (keep < messages[0].content.length) {
        messages[0] = {
          ...messages[0],
          content:
            messages[0].content.slice(0, keep) +
            " …",
        };
      }
    }
  }

  return {
    messages,
    dropped,
    factCount: facts.length,
    hasSummary: Boolean(summary.trim()),
    tokensUsed,
  };
}


// ==========================================
// ROLLING SUMMARY (BACKGROUND)
// ==========================================
//
// Folds the turns that fell out of the window
// into the stored summary. Runs after the reply
// has already been streamed, so the user never
// waits on it.
//

export async function updateRollingSummary(options: {
  db: Db;
  scope: Scope;
  dropped: StoredMessage[];
}) {
  if (options.dropped.length < SUMMARY_TRIGGER) {
    return;
  }

  const existing = await getSummary(
    options.db,
    options.scope
  );

  // Only summarise turns we have not folded in
  // before, so repeated calls stay cheap.

  const fresh = options.dropped.slice(
    existing.covered_count
  );

  if (fresh.length < SUMMARY_TRIGGER) {
    return;
  }

  const transcript = fresh
    .map(
      (message) =>
        `${
          message.role === "user"
            ? "User"
            : "Assistant"
        }: ${message.content}`
    )
    .join("\n\n")
    .slice(0, 12000);

  const prompt = [
    existing.summary
      ? `Existing summary:\n${existing.summary}`
      : "There is no existing summary yet.",
    "",
    "New conversation to fold in:",
    transcript,
  ].join("\n");

  try {
    const result = await completeJson<{
      summary?: string;
    }>({
      system: [
        "You maintain a running summary of a conversation.",
        "Merge the new turns into the existing summary.",
        "Keep decisions, requirements, names, file names and unresolved questions.",
        "Drop small talk and anything already superseded.",
        'Return JSON: {"summary": "..."} with at most 200 words of plain prose.',
      ].join(" "),

      prompt,

      schema: {
        type: "object",
        properties: {
          summary: { type: "string" },
        },
        required: ["summary"],
      },

      numPredict: 600,
    });

    const summary = result?.summary?.trim();

    if (summary) {
      await saveSummary(
        options.db,
        options.scope,
        summary,
        options.dropped.length
      );
    }
  } catch (error) {
    console.error(
      "Rolling summary failed:",
      error
    );
  }
}


// ==========================================
// FACT EXTRACTION (BACKGROUND)
// ==========================================

export async function extractFacts(options: {
  db: Db;
  scope: Scope;
  userMessage: string;
  assistantMessage: string;
  sourceMessageId?: string | null;
}) {
  if (!options.userMessage.trim()) {
    return;
  }

  // In a channel, facts are sorted into this channel's
  // memory and the project's shared memory. Outside one,
  // everything is already project memory.
  const inChannel = Boolean(options.scope.channelId);
  const shared = projectScope(options.scope);

  const explicit =
    inChannel && asksForProjectMemory(options.userMessage);

  const [ownKnown, sharedKnown] = await Promise.all([
    getFacts(options.db, options.scope, 25),
    inChannel ? getFacts(options.db, shared, 15) : Promise.resolve([]),
  ]);

  const known = [...sharedKnown, ...ownKnown]
    .map((fact) => `- ${fact.content}`)
    .join("\n");

  const prompt = [
    known
      ? `Already remembered:\n${known}`
      : "Nothing is remembered yet.",
    "",
    explicit
      ? "The user explicitly asked for this to be remembered for the whole project: put it in project_facts."
      : "",
    `User: ${options.userMessage.slice(0, 4000)}`,
    "",
    `Assistant: ${options.assistantMessage.slice(
      0,
      4000
    )}`,
  ].join("\n");

  const clean = (list: string[] | undefined) =>
    (list ?? [])
      .map((fact) => fact.trim())
      .filter((fact) => fact.length > 3 && fact.length < 240)
      .slice(0, 5);

  try {
    const result = await completeJson<{
      facts?: string[];
      project_facts?: string[];
    }>({
      system: [
        "Extract durable facts worth remembering long term:",
        "the user's name, role, preferences, ongoing projects, constraints and goals.",
        "Ignore chit-chat, one-off questions, and anything already remembered.",
        inChannel
          ? "Sort them: project_facts are things the WHOLE team relies on in every channel - the project's goal or brief, problem statement, tech stack, deadlines, who does what, and decisions the team agreed on - or anything the user asks to remember for the whole project or team. Everything else goes in facts."
          : "",
        'Return JSON: {"facts": ["..."], "project_facts": ["..."]}.',
        "Use empty arrays if there is nothing worth remembering.",
      ].join(" "),

      prompt,

      schema: {
        type: "object",
        properties: {
          facts: {
            type: "array",
            items: { type: "string" },
          },
          project_facts: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["facts", "project_facts"],
      },

      numPredict: 400,
    });

    const own = clean(result?.facts);
    let projectWide = clean(result?.project_facts);

    // Asked for in words, it is remembered for everyone -
    // even if the model filed nothing - in the person's
    // own words, capped like any fact.
    if (explicit && projectWide.length === 0) {
      projectWide = [options.userMessage.trim().slice(0, 239)];
    }

    await Promise.all([
      addFacts(
        options.db,
        options.scope,
        inChannel ? own : [...own, ...projectWide],
        "auto",
        null,
        options.sourceMessageId ?? null
      ),
      inChannel && projectWide.length > 0
        ? addFacts(
            options.db,
            shared,
            projectWide,
            "auto",
            null,
            options.sourceMessageId ?? null
          )
        : Promise.resolve(),
    ]);
  } catch (error) {
    console.error(
      "Fact extraction failed:",
      error
    );

    // The model is down, but a request to remember
    // something for everyone was made in words: keep it.
    if (explicit) {
      await addFacts(
        options.db,
        shared,
        [options.userMessage.trim().slice(0, 239)],
        "auto",
        null,
        options.sourceMessageId ?? null
      );
    }
  }
}
