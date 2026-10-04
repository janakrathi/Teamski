// ==========================================
// A MODEL'S NAME, FOR PEOPLE
// ==========================================
//
// Replies are labelled with the model that wrote them
// rather than "Agent". Ids arrive as the service and the
// provider's own id ("groq/openai/gpt-oss-120b",
// "google/gemini-3.5-flash-lite", "qwen3:1.7b"); this
// turns them into what people call them ("GPT-OSS 120B",
// "Gemini 3.5 Flash Lite", "Qwen3 1.7B").
//
// No lookup table to keep in step with providers: the
// last part of the id, tidied.
//

const UPPER = new Set(["gpt", "oss", "glm", "ai", "vl", "it"]);

const NAMES: Record<string, string> = {
  deepseek: "DeepSeek",
  openai: "OpenAI",
  chatgpt: "ChatGPT",
  minimax: "MiniMax",
  phi: "Phi",
};

export function modelDisplayName(id: string | null | undefined): string | null {
  if (!id || !id.trim()) {
    return null;
  }

  // The provider's own id: what follows the last slash.
  let name = id.trim().split("/").pop() ?? id;

  name = name
    .replace(/[:@-]latest$/i, "")
    .replace(/-\d{8}$/, "") // a date stamp, e.g. -20251001
    .replace(/-(instruct|preview|chat)$/i, "");

  const tokens = name.split(/[-_:\s]+/).filter(Boolean);

  const words: string[] = [];

  for (const token of tokens) {
    const lower = token.toLowerCase();
    const previous = words[words.length - 1];

    // "5-5" in claude-sonnet-5-5 is version 5.5.
    if (/^\d+$/.test(token) && previous && /^\d+(\.\d+)?$/.test(previous)) {
      words[words.length - 1] = `${previous}.${token}`;
      continue;
    }

    if (/^\d+(\.\d+)?[bmk]$/i.test(token)) {
      words.push(token.toUpperCase());
    } else if (/^a\d+(\.\d+)?b$/i.test(token)) {
      // Active parameters, as in 30b-a3b.
      words.push(token.toUpperCase());
    } else if (UPPER.has(lower)) {
      words.push(lower.toUpperCase());
    } else if (NAMES[lower]) {
      words.push(NAMES[lower]);
    } else {
      words.push(token.charAt(0).toUpperCase() + token.slice(1));
    }
  }

  return (
    words
      .join(" ")
      // OpenAI's own spellings.
      .replace(/^GPT OSS\b/, "GPT-OSS")
      .replace(/^GPT (\d)/, "GPT-$1") || null
  );
}
