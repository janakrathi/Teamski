// ==========================================
// SENDING EMAIL
// ==========================================
//
// Through Resend's HTTP API - one request, no SDK
// to keep up to date. Without a key nothing is
// sent and nothing breaks: the caller is told it
// was not sent, and says so to the person who
// clicked.
//
//   RESEND_API_KEY  from resend.com, after the
//                   teamski.in domain is verified
//   EMAIL_FROM      "Teamski <invites@teamski.in>"
//
// A failure to send is never a failure of the
// thing that triggered it. An invite still exists
// if its email bounced.
//

export type Email = {
  to: string;
  subject: string;
  html: string;
  text: string;

  // Replies go to a person, not a no-reply box.
  replyTo?: string;
};

export type SendResult =
  | { sent: true; id: string }
  | { sent: false; reason: "not-configured" | "failed"; detail?: string };


export function emailConfigured() {
  return Boolean(
    process.env.RESEND_API_KEY && process.env.EMAIL_FROM
  );
}


export async function sendEmail(
  email: Email
): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!key || !from) {
    return { sent: false, reason: "not-configured" };
  }

  try {
    const response = await fetch(
      "https://api.resend.com/emails",
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          from,
          to: [email.to],
          subject: email.subject,
          html: email.html,
          text: email.text,
          ...(email.replyTo
            ? { reply_to: email.replyTo }
            : {}),
        }),

        signal: AbortSignal.timeout(10_000),
      }
    );

    const data = (await response
      .json()
      .catch(() => ({}))) as { id?: string; message?: string };

    if (!response.ok || !data.id) {
      console.error(
        "Email not sent:",
        response.status,
        data.message
      );

      return {
        sent: false,
        reason: "failed",
        detail: data.message,
      };
    }

    return { sent: true, id: data.id };
  } catch (error) {
    console.error("Email not sent:", error);

    return { sent: false, reason: "failed" };
  }
}
