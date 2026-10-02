// ==========================================
// ENTERPRISE ENQUIRIES
// ==========================================
//
// What the "Contact sales" form sends, checked on the
// server before it goes anywhere. The form is on a
// public page, so everything here is typed by a
// stranger: lengths are capped, the email has to look
// like one, and nothing is trusted to be the shape the
// form promised.
//
// Pure, so the rules can be tested without a request.
//

export const TEAM_SIZES = [
  "1–10",
  "11–50",
  "51–200",
  "201–1,000",
  "1,000+",
] as const;

export type Lead = {
  name: string;
  email: string;
  company: string;
  role: string;
  teamSize: string;
  phone: string;
  country: string;
  needs: string;
};

const LIMITS: Record<keyof Lead, number> = {
  name: 100,
  email: 200,
  company: 150,
  role: 100,
  teamSize: 20,
  phone: 40,
  country: 80,
  needs: 3000,
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;


function text(value: unknown, max: number) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}


export function cleanLead(
  input: unknown
): { ok: true; lead: Lead } | { ok: false; error: string } {
  const raw = (input ?? {}) as Record<string, unknown>;

  const lead: Lead = {
    name: text(raw.name, LIMITS.name),
    email: text(raw.email, LIMITS.email).toLowerCase(),
    company: text(raw.company, LIMITS.company),
    role: text(raw.role, LIMITS.role),
    teamSize: text(raw.teamSize, LIMITS.teamSize),
    phone: text(raw.phone, LIMITS.phone),
    country: text(raw.country, LIMITS.country),

    // The one field where line breaks mean something.
    needs:
      typeof raw.needs === "string"
        ? raw.needs.trim().slice(0, LIMITS.needs)
        : "",
  };

  if (!lead.name) {
    return { ok: false, error: "Please add your name." };
  }

  if (!EMAIL.test(lead.email)) {
    return { ok: false, error: "Please add a valid work email." };
  }

  if (!lead.company) {
    return { ok: false, error: "Please add your company or organisation." };
  }

  if (!(TEAM_SIZES as readonly string[]).includes(lead.teamSize)) {
    return { ok: false, error: "Please pick your team size." };
  }

  if (lead.needs.length < 10) {
    return {
      ok: false,
      error: "Tell us a little about what you need (a sentence or two).",
    };
  }

  return { ok: true, lead };
}


// A cell that starts with = + - or @ is a formula to
// Google Sheets. Typed by a stranger, that is a way to
// run something in the sheet of whoever opens it, so
// such values are stored as plain text instead.

export function sheetSafe(value: string) {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
