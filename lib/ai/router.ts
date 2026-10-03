import type { OllamaMessage, ToolSpec } from "./ollama.ts";


// ==========================================
// AUTO: THE CHEAPEST MODEL THAT CAN DO IT
// ==========================================
//
// A team on its own Claude or OpenAI key can pick
// "Auto" instead of one model. Quick asks - a reply, a
// reword, a short answer - go to the small model; real
// work - code, web pages, images, research, analysis,
// long or detailed requests - goes to the strong one.
// The small model costs a fraction as much, and most
// messages in a team chat are quick asks.
//
// Decided once per turn from the message itself: no
// extra model call to decide, which would cost more
// than it saves. Every tool step of a turn then stays on
// the model the first step used (the chat route passes
// back what answered), so the turn keeps one prompt
// cache - caches belong to a model.
//

export const AUTO_MODEL = "auto";

const TIERS: Record<string, { cheap: string; strong: string }> = {
  anthropic: { cheap: "claude-haiku-4-5", strong: "claude-sonnet-5-5" },
  openai: { cheap: "gpt-4.1-mini", strong: "gpt-4.1" },
};

export function autoAvailable(service: string) {
  return service in TIERS;
}

export const AUTO_INFO = {
  id: AUTO_MODEL,
  label: "Auto (saves cost)",
};


// What makes a message real work rather than a quick ask.

const WORK = new RegExp(
  [
    // building and code
    "\\b(code|coding|bug|debug|error|stack ?trace|refactor|function|api|sql|regex|script|component|deploy|landing[ -]?page|web ?site|web[ -]?page|home[ -]?page|html|css|javascript|typescript|python)\\b",
    // thinking work
    "\\b(architecture|strategy|analy[sz]e|analysis|compare|comparison|evaluate|assess|plan|roadmap|research|investigate|report|proposal|pitch|deck|contract|legal|financial|forecast|budget|pricing model)\\b",
    // long-form writing
    "\\b(essay|article|blog ?post|whitepaper|case study|press release|newsletter|sequence|campaign|script)\\b",
    // reasoning asks
    "\\b(step[ -]by[ -]step|in detail|detailed|thorough|why (does|is|do|did)|prove|calculate|optimi[sz]e)\\b",
  ].join("|"),
  "i"
);

export function needsStrongModel(options: {
  message: string;
  hasImages: boolean;
  tools?: ToolSpec[];
}): { strong: boolean; why: string } {
  if (options.hasImages) {
    return { strong: true, why: "has images" };
  }

  if (options.message.length > 500) {
    return { strong: true, why: "long request" };
  }

  if (options.message.includes("```")) {
    return { strong: true, why: "contains code" };
  }

  const writesFiles = (options.tools ?? []).some((tool) =>
    /^(create_file|edit_file)$/.test(tool.function?.name ?? "")
  );

  if (writesFiles && /\b(html|page|site|code|script)\b/i.test(options.message)) {
    return { strong: true, why: "building a file" };
  }

  if (WORK.test(options.message)) {
    return { strong: true, why: "real work" };
  }

  return { strong: false, why: "quick ask" };
}


// "anthropic/auto" -> "anthropic/claude-haiku-4-5" or
// "anthropic/claude-sonnet-5-5"; anything else is
// returned unchanged.

export function resolveAuto(
  qualifiedModel: string,
  options: { messages: OllamaMessage[]; tools?: ToolSpec[] }
) {
  const slash = qualifiedModel.indexOf("/");

  if (slash === -1) {
    return qualifiedModel;
  }

  const service = qualifiedModel.slice(0, slash);
  const model = qualifiedModel.slice(slash + 1);

  if (model !== AUTO_MODEL || !(service in TIERS)) {
    return qualifiedModel;
  }

  const latest =
    [...options.messages].reverse().find((message) => message.role === "user") ?? null;

  const decision = needsStrongModel({
    message: latest?.content ?? "",
    hasImages: options.messages.some(
      (message) => message.role === "user" && (message.images?.length ?? 0) > 0
    ),
    tools: options.tools,
  });

  const tier = TIERS[service];

  const chosen = decision.strong ? tier.strong : tier.cheap;

  console.log(`[router] ${qualifiedModel} -> ${chosen} (${decision.why})`);

  return `${service}/${chosen}`;
}


// ==========================================
// WHICH MODELS CAN READ IMAGES
// ==========================================
//
// A message with an image attached used to go to the
// free shared vision model whatever the channel ran.
// When the channel's own model can read images - every
// current Claude, GPT-4o/4.1/5, Gemini - it answers
// itself, and far better. Unknown models are assumed
// not to, so an image is never silently ignored.

export function canReadImages(qualifiedModel: string) {
  const slash = qualifiedModel.indexOf("/");

  if (slash === -1) {
    return false;
  }

  const service = qualifiedModel.slice(0, slash);
  const model = qualifiedModel.slice(slash + 1).toLowerCase();

  if (service === "anthropic") {
    return true;
  }

  if (service === "openai") {
    return model === AUTO_MODEL || /^(gpt-4o|gpt-4\.1|gpt-5|o3|o4)/.test(model);
  }

  // A ChatGPT plan's models are GPT-5 and later.
  if (service === "chatgpt") {
    return model.startsWith("gpt-");
  }

  if (service === "google") {
    return model.startsWith("gemini");
  }

  // Through OpenRouter, judge by the model behind it.
  if (service === "openrouter") {
    return /^(anthropic\/claude|openai\/(gpt-4o|gpt-4\.1|gpt-5)|google\/gemini)/.test(model);
  }

  return false;
}
