// ==========================================
// GROQ'S IMAGE-READING MODEL
// ==========================================
//
// Teamski serves no hosted models off keys of its
// own - only the machine's models are built in.
// Groq is a bring-your-own-key preset
// (compatible.ts): free keys from console.groq.com
// work on every plan.
//
// What stays here is the one Groq model the app
// reaches for by name: the machine's models can't
// read images, so a turn with an image attached goes
// to Qwen on the person's own Groq key when they have
// one. Qualified the way the router expects ("groq/"
// + Groq's own id, which keeps the maker's slash).
// Takes up to 3 images, each ~2048 tokens.

export const GROQ_VISION_MODEL =
  "groq/qwen/qwen3.8-27b";
