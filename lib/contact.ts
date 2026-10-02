// ==========================================
// CONTACT US
// ==========================================
//
// What the "Contact us" form on the front page sends,
// checked on the server before it goes anywhere. Like
// the Contact sales form, everything here was typed
// by a stranger: lengths are capped, the email has to
// look like one, and the topic must be one we offer.
//
// Pure, so the rules can be tested without a request.
//

export const TOPICS = [
  "A question",
  "Help with my account",
  "Partnership or hackathon",
  "Press",
  "Something else",
] as const;

export type ContactMessage = {
  name: string;
  email: string;
  topic: string;
  message: string;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function text(value: unknown, max: number) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

export function cleanContact(
  input: unknown
): { ok: true; message: ContactMessage } | { ok: false; error: string } {
  const raw = (input ?? {}) as Record<string, unknown>;

  const message: ContactMessage = {
    name: text(raw.name, 100),
    email: text(raw.email, 200).toLowerCase(),
    topic: text(raw.topic, 40),

    // The one field where line breaks mean something.
    message:
      typeof raw.message === "string"
        ? raw.message.trim().slice(0, 3000)
        : "",
  };

  if (!message.name) {
    return { ok: false, error: "Please add your name." };
  }

  if (!EMAIL.test(message.email)) {
    return { ok: false, error: "Please add a valid email, so we can reply." };
  }

  if (!(TOPICS as readonly string[]).includes(message.topic)) {
    return { ok: false, error: "Please pick what it's about." };
  }

  if (message.message.length < 10) {
    return {
      ok: false,
      error: "Tell us a little more (a sentence or two).",
    };
  }

  return { ok: true, message };
}
