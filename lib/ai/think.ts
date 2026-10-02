// ==========================================
// WHEN THE MODEL SHOULD THINK FIRST
// ==========================================
//
// Thinking before answering costs time the person
// spends looking at nothing: on the CPU server,
// qwen3:1.7b wrote 170-450 hidden tokens first,
// 7-19 seconds before the first visible word.
//
// But it is what makes a small model call tools
// properly. Measured on qwen3:1.7b with the file
// tools offered, 20 requests each way:
//
//   thinking on    20/20 right
//   thinking off   14/20 - "[list_files]" or a
//                  "<tool>{...}" typed out as text
//                  instead of actually run
//
// So it thinks when the message reads like a
// request to do something - the same action words
// the system prompt tells it to look for - and
// answers straight away when it is conversation,
// which most messages are. A false alarm costs a
// few seconds; a miss costs a tool that never ran.
//

const ACTIONS = [
  // files
  "create", "write", "save", "make", "read", "open", "show", "edit",
  "update", "change", "rename", "delete", "remove", "list", "file",
  "files", "folder", "note", "notes", "append", "add",

  // the web
  "search", "look up", "lookup", "google", "find", "fetch", "browse",
  "website", "link", "url", "latest", "news", "today",

  // connected apps
  "sheet", "sheets", "spreadsheet", "row", "rows", "github", "repo",
  "issue", "issues", "code", "email", "gmail", "calendar", "drive",
  "doc", "docs", "notion", "linear", "jira", "asana", "sentry",
  "stripe", "canva", "page", "task", "tasks", "ticket",
];

const PATTERN = new RegExp(
  `\\b(${ACTIONS.map((word) => word.replace(/ /g, "\\s+")).join("|")})\\b` +
    // A filename or an address is a request too.
    `|\\b[\\w-]+\\.(md|txt|csv|json|js|ts|py|html)\\b|https?://`,
  "i"
);


export function shouldThink(options: {
  // The message being answered.
  message: string;

  // Whether any tools are on offer at all.
  tools: boolean;

  // The person asked to see the reasoning.
  showReasoning: boolean;
}) {
  if (options.showReasoning) {
    return true;
  }

  if (!options.tools) {
    return false;
  }

  return PATTERN.test(options.message);
}


// ==========================================
// WHEN TO OFFER THE FILE TOOLS
// ==========================================
//
// Offered on every message, a small model reaches
// for them unasked: asked to split topics among
// five people, it listed the project's files and
// described each one in the reply. So the file
// tools are only on the table when the message is
// about files - and the prompt is shorter, and
// faster to read, the rest of the time.
//

const FILE_WORDS = new RegExp(
  "\\b(files?|folders?|notes?|save|saved|saving|document|documents|doc|docs|attachment|attachments|download|upload)\\b" +
    // "create/write/make a ... file" style requests
    "|\\b(create|write|make|read|open|edit|update|delete|remove|rename|list|show)\\b[^.?!]{0,40}\\b(file|notes?|doc|document|md|txt|csv|json)\\b" +
    // a filename
    "|\\b[\\w-]+\\.(md|txt|csv|json|js|ts|py|html|yaml|yml)\\b",
  "i"
);


export function wantsFiles(message: string) {
  return FILE_WORDS.test(message);
}


// ==========================================
// WHEN TO OFFER THE IMAGE GENERATOR
// ==========================================
//
// Like the file tools, the image generator is only
// on the table when the message reads like a request
// for a picture. That keeps the tool schema out of
// the request the rest of the time - it matters for
// the token-per-minute cap on the shared key - and
// stops a small model reaching for it unasked.
//

const IMAGE_WORDS = new RegExp(
  // A picture noun.
  "\\b(image|images|picture|pictures|photo|photos|logo|logos|icon|icons|" +
    "illustration|illustrations|artwork|drawing|drawings|poster|posters|" +
    "banner|banners|wallpaper|avatar|avatars|sticker|stickers|graphic|" +
    "graphics|mockup|thumbnail)\\b" +
    // Verbs that always mean making a picture.
    "|\\b(draw|sketch|paint|illustrate|doodle)\\b" +
    // A generic verb aimed at a picture noun.
    "|\\b(generate|create|make|design|render)\\b" +
    "[^.?!]{0,40}\\b(image|picture|photo|logo|icon|art|illustration|" +
    "poster|banner|avatar|scene|character)\\b",
  "i"
);


export function wantsImage(message: string) {
  return IMAGE_WORDS.test(message);
}


// ==========================================
// WHETHER TO OFFER TOOLS AT ALL
// ==========================================
//
// A model handed a list of tools can decide to call
// one even when nothing was asked - and some models
// invent a tool that was never offered, which a
// strict provider (Groq) then refuses outright. So a
// plainly conversational message is answered with no
// tools on the table, which also keeps the request
// small. Anything that reads like a request to do
// something gets the tools.
//

// A question or a request for current facts should
// get the web tool, so the model searches rather than
// declining - or, worse, inventing an answer. Kept
// broad on purpose: web search is cheap (a couple of
// hundred tokens) and the model simply ignores it when
// it does not need it.

const INFO_SEEKING = new RegExp(
  // A question mark, or a question-word opening.
  "\\?" +
    "|^\\s*(who|what|what's|whats|when|where|why|which|how)\\b" +
    // Things that need current, real-world facts.
    "|\\b(weather|temperature|forecast|climate|price|prices|pricing|" +
    "cost|costs|rate|rates|stock|shares|market|score|scores|news|" +
    "headline|headlines|today|tonight|tomorrow|current|currently|" +
    "now|latest|recent|release|released|population|distance|" +
    "timezone|time\\s+in|open|hours|near\\s+me)\\b",
  "i"
);


export function mightUseTools(message: string) {
  return (
    PATTERN.test(message) ||
    FILE_WORDS.test(message) ||
    IMAGE_WORDS.test(message) ||
    INFO_SEEKING.test(message)
  );
}
