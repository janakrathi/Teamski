import type { Email } from "./send.ts";


// ==========================================
// WHAT THE EMAILS SAY
// ==========================================
//
// Project names and people's names are typed by
// users, so they are escaped before they go
// anywhere near HTML. An invite that lets someone
// put a link or a fake button in another person's
// inbox, under our name, is a phishing kit.
//
// Plain layout, one button, and a text version for
// mail clients that show no HTML. Nothing here
// makes a promise about the product.
//

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


// A name is typed by a user and lands in a
// stranger's inbox under our name, so links are
// taken out of it - mail clients turn bare
// addresses into links even in plain text. Length
// is capped for the subject line.

const LINKS = [
  /[a-z][a-z0-9+.-]*:\/\/\S+/gi,
  /\bwww\.\S+/gi,
  /\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|in|net|org|io|co|app|dev|xyz|info|biz|me|ly|link|click|top|site|online|shop)\b\S*/gi,
];

export function tidy(value: string, max = 80) {
  let trimmed = value;

  for (const pattern of LINKS) {
    trimmed = trimmed.replace(pattern, "[link]");
  }

  trimmed = trimmed.replace(/\s+/g, " ").trim();

  return shorten(trimmed, max);
}


function shorten(value: string, max: number) {
  return value.length > max
    ? `${value.slice(0, max - 1)}…`
    : value;
}


function layout(options: {
  heading: string;
  body: string;
  button: { label: string; url: string };
  footer: string;
}) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f6f5f2;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a18">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e6e3dd;border-radius:12px">
            <tr>
              <td style="padding:28px 28px 8px;font-size:15px;font-weight:600">Teamski</td>
            </tr>
            <tr>
              <td style="padding:8px 28px 0;font-size:20px;line-height:1.35;font-weight:600">${options.heading}</td>
            </tr>
            <tr>
              <td style="padding:12px 28px 0;font-size:14px;line-height:1.6;color:#4a4845">${options.body}</td>
            </tr>
            <tr>
              <td style="padding:24px 28px 28px">
                <a href="${options.button.url}" style="display:inline-block;background:#1a1a18;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 18px;border-radius:8px">${options.button.label}</a>
              </td>
            </tr>
          </table>
          <p style="max-width:480px;margin:16px auto 0;font-size:12px;line-height:1.5;color:#8a8782">${options.footer}</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}


// ------------------------------------------
// INVITED TO A PROJECT
// ------------------------------------------
//
// Two cases with different buttons: somebody with
// an account is already in the project and only
// needs to open it; somebody without one joins
// when they sign up with this address.
//

export function projectInviteEmail(options: {
  to: string;

  // A display name the inviter chose, which is
  // cleaned of links. Absent, their sign-in email
  // is shown as it is - that one is real, and
  // stripping its domain would mangle it.
  inviterName?: string | null;
  inviterEmail?: string | null;

  projectName: string;
  site: string;
  hasAccount: boolean;
}): Email {
  const inviter = options.inviterName?.trim()
    ? tidy(options.inviterName)
    : shorten(options.inviterEmail?.trim() || "Someone", 80);
  const project = tidy(options.projectName);

  const url = options.hasAccount
    ? `${options.site}/`
    : `${options.site}/login?mode=signup`;

  const subject = options.hasAccount
    ? `${inviter} added you to ${project} on Teamski`
    : `${inviter} invited you to ${project} on Teamski`;

  const lead = options.hasAccount
    ? `${inviter} added you to the project “${project}”. It is in your project list now.`
    : `${inviter} invited you to join the project “${project}” on Teamski, where their team works together with AI agents.`;

  const next = options.hasAccount
    ? ""
    : `Sign up with this email address (${options.to}) and you will be in the project straight away.`;

  const footer = `You received this because ${inviter} entered your email address in Teamski. If you did not expect it, you can ignore this email.`;

  return {
    to: options.to,
    subject,
    replyTo: options.inviterEmail ?? undefined,

    html: layout({
      heading: escapeHtml(
        options.hasAccount
          ? `You were added to ${project}`
          : `Join ${project} on Teamski`
      ),

      body: [lead, next]
        .filter(Boolean)
        .map((line) => `<p style="margin:0 0 10px">${escapeHtml(line)}</p>`)
        .join(""),

      button: {
        label: options.hasAccount ? "Open Teamski" : "Accept invite",
        url: escapeHtml(url),
      },

      footer: escapeHtml(footer),
    }),

    text: [
      options.hasAccount
        ? `You were added to ${project}`
        : `Join ${project} on Teamski`,
      "",
      lead,
      next,
      "",
      `${options.hasAccount ? "Open Teamski" : "Accept invite"}: ${url}`,
      "",
      footer,
    ]
      .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
      .join("\n"),
  };
}


// ------------------------------------------
// TEAM PLAN RENEWAL REMINDER
// ------------------------------------------
//
// Goes to the project owner - the only person billed
// - a few days before the Team plan lapses, and once
// more if it already has. Never asks for a card in
// the email; the button opens Teamski, where the
// owner renews through the payment provider.

export function renewalReminderEmail(options: {
  to: string;
  projectName: string;
  site: string;

  // Pre-formatted in the owner's currency, e.g. "₹549".
  price: string;
  includedMembers: number;

  // Already formatted, e.g. "16 Oct 2026".
  renewsOn: string;

  // Days until it lapses; 0 or less means it already has.
  daysLeft: number;

  // A free trial ending, not a paid plan renewing - so
  // the words are "upgrade", not "renew".
  trial?: boolean;
}): Email {
  const project = tidy(options.projectName);
  const lapsed = options.daysLeft <= 0;
  const trial = Boolean(options.trial);

  const when = lapsed
    ? "has ended"
    : options.daysLeft === 1
      ? "ends tomorrow"
      : `ends in ${options.daysLeft} days`;

  const thing = trial ? "free trial" : "Team plan";

  const subject = lapsed
    ? trial
      ? `Your free trial of “${project}” has ended`
      : `The Team plan for “${project}” has ended`
    : trial
      ? `Your free trial of “${project}” ${when}`
      : `Your Team plan for “${project}” ${when}`;

  const heading = lapsed
    ? `“${project}” is back on Free`
    : `“${project}” — ${trial ? "trial" : "Team"} ${when}`;

  const lead = lapsed
    ? `The ${thing} for “${project}” ended on ${options.renewsOn}, and the project is back on Free. ${
        trial ? "Upgrade" : "Renew"
      } to restore Team for everyone in it.`
    : `The ${thing} for “${project}” ${when}, on ${options.renewsOn}. ${
        trial ? "Upgrade" : "Renew"
      } before then to keep the faster AI, higher daily limits, shared keys and scheduled agents for the whole project.`;

  const priceLine = `${options.price} / month, for up to ${options.includedMembers} people.`;

  const footer = `You’re getting this because you own “${project}” on Teamski. Only the project owner is billed. If you’d rather stay on Free, you can ignore this — nothing will be charged.`;

  const buttonLabel = lapsed
    ? trial
      ? "Upgrade to Team"
      : "Restore Team"
    : trial
      ? "Upgrade to Team"
      : "Renew Team";

  const url = `${options.site}/`;

  return {
    to: options.to,
    subject,

    html: layout({
      heading: escapeHtml(heading),

      body: [lead, priceLine]
        .map(
          (line) =>
            `<p style="margin:0 0 10px">${escapeHtml(line)}</p>`
        )
        .join(""),

      button: { label: buttonLabel, url },
      footer: escapeHtml(footer),
    }),

    text: [
      heading,
      "",
      lead,
      priceLine,
      "",
      `${buttonLabel}: ${url}`,
      "",
      footer,
    ].join("\n"),
  };
}


// ------------------------------------------
// COMING-BACK NUDGE
// ------------------------------------------
//
// Goes once to someone who created an account, had a
// look, and did not come back after a couple of days.
// No promises, no pressure - just a reminder of what
// Teamski is for, and the one button that reopens it.
// Same plain black-and-white layout as every other
// email here.

export function winbackEmail(options: {
  to: string;
  site: string;

  // The name they chose, if any, cleaned of links. A
  // blank one just drops the greeting - better no name
  // than a wrong one.
  name?: string | null;
}): Email {
  const name = options.name?.trim()
    ? tidy(options.name, 40)
    : "";

  const greeting = name ? `Hi ${name},` : "Hi,";

  const heading = "Your team's AI is still here";

  const lead = [
    greeting,
    "You started an account on Teamski and then it went quiet - so here's the two-line version of what it's for.",
    "Teamski is one AI teammate the whole group shares: it sits in your channels, remembers the project, and does the work alongside everyone. Point it at a group assignment, a hackathon build, product research, a launch plan - anything you'd normally split across a dozen chats. It's free to start, and a project you make now gets two months of the full plan on us.",
    "Open it, make a project, drop in your first message. That's the whole setup.",
  ];

  const footer =
    "You're getting this once because you signed up for Teamski. If it's not for you, just ignore this - we won't email again.";

  const url = `${options.site}/`;

  return {
    to: options.to,
    subject: "Your team's AI is waiting on Teamski",

    html: layout({
      heading: escapeHtml(heading),

      body: lead
        .map(
          (line) =>
            `<p style="margin:0 0 10px">${escapeHtml(line)}</p>`
        )
        .join(""),

      button: { label: "Open Teamski", url },
      footer: escapeHtml(footer),
    }),

    text: [heading, "", ...lead, "", `Open Teamski: ${url}`, "", footer].join(
      "\n"
    ),
  };
}


// ------------------------------------------
// NEW ENTERPRISE ENQUIRY
// ------------------------------------------
//
// Goes to the Teamski team when someone fills in the
// "Contact sales" form, as a backup to the Google
// Sheet - a lead is never lost because the sheet was
// down. Every field was typed by a stranger, so all of
// it is escaped, and replying goes straight to them.

export function enterpriseLeadEmail(options: {
  to: string;
  site: string;
  lead: {
    name: string;
    email: string;
    company: string;
    role: string;
    teamSize: string;
    phone: string;
    country: string;
    needs: string;
  };
}): Email {
  const { lead } = options;

  const company = tidy(lead.company);

  const rows: [string, string][] = [
    ["Name", lead.name],
    ["Email", lead.email],
    ["Company", lead.company],
    ["Role", lead.role || "—"],
    ["Team size", lead.teamSize],
    ["Phone", lead.phone || "—"],
    ["Country", lead.country || "—"],
  ];

  const table = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:3px 12px 3px 0;color:#8a8782;white-space:nowrap;vertical-align:top">${escapeHtml(
          label
        )}</td><td style="padding:3px 0;color:#1a1a18">${escapeHtml(
          value
        )}</td></tr>`
    )
    .join("");

  const needs = escapeHtml(lead.needs).replace(/\n/g, "<br>");

  const url = `${options.site}/admin`;

  return {
    to: options.to,
    subject: `Enterprise enquiry: ${company} (${lead.teamSize})`,
    replyTo: lead.email,

    html: layout({
      heading: escapeHtml(`New enterprise enquiry from ${company}`),

      body: `<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.5">${table}</table><p style="margin:16px 0 6px;color:#8a8782">What they need</p><p style="margin:0">${needs}</p>`,

      button: { label: "Open Teamski", url },

      footer: escapeHtml(
        "Sent from the Contact sales form on teamski.in. Reply to this email to answer them directly."
      ),
    }),

    text: [
      `New enterprise enquiry from ${company}`,
      "",
      ...rows.map(([label, value]) => `${label}: ${value}`),
      "",
      "What they need:",
      lead.needs,
    ].join("\n"),
  };
}
