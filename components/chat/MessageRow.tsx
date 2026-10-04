"use client";

import { memo, useState } from "react";

import Markdown from "./Markdown";
import { AttachmentList } from "./Attachments";
import type {
  ApprovalRequest,
  ChatMessage,
} from "./useChat";

import FilePreview, { canPreview } from "./FilePreview";


// ==========================================
// ACTIVITY TRAIL
// ==========================================

function ActivityTrail({
  activity,
}: {
  activity: NonNullable<ChatMessage["activity"]>;
}) {
  const [open, setOpen] = useState(true);

  const running = activity.some(
    (item) => item.status === "working"
  );

  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-panel)]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-[var(--bg-hover)]"
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            running
              ? "animate-pulse bg-[var(--accent)]"
              : "bg-emerald-600"
          }`}
        />

        <span className="text-[11px] font-medium text-[var(--text-muted)]">
          {running
            ? "Working"
            : `${activity.length} ${
                activity.length === 1
                  ? "step"
                  : "steps"
              }`}
        </span>

        <span className="ml-auto text-[10px] text-[var(--text-faint)]">
          {open ? "Hide" : "Show"}
        </span>
      </button>

      {open && (
        <div className="space-y-1.5 border-t border-[var(--border)] px-3 py-2.5">
          {activity.map((item) => (
            <div
              key={item.key}
              className="t-rise flex items-center gap-2 text-[12.5px]"
            >
              {item.status === "done" ? (
                <span className="text-emerald-500">
                  ✓
                </span>
              ) : item.status === "failed" ? (
                <span className="text-rose-500">
                  ✕
                </span>
              ) : item.status === "blocked" ? (
                <span className="text-amber-500">
                  !
                </span>
              ) : (
                <span className="animate-pulse text-[var(--accent)]">
                  ●
                </span>
              )}

              <span
                className={
                  item.status === "working"
                    ? "text-[var(--text-muted)]"
                    : "text-[var(--text)]"
                }
              >
                {item.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ==========================================
// THINKING
// ==========================================

function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-panel)]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-[var(--bg-hover)]"
      >
        <span className="text-[11px] font-medium text-[var(--text-muted)]">
          Reasoning
        </span>

        <span className="ml-auto text-[10px] text-[var(--text-faint)]">
          {open ? "Hide" : "Show"}
        </span>
      </button>

      {open && (
        <p className="border-t border-[var(--border)] px-3 py-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-[var(--text-muted)]">
          {text}
        </p>
      )}
    </div>
  );
}


// ==========================================
// MESSAGE
// ==========================================

// "google/gemini-3.8-flash" -> "gemini-3.8-flash".
function modelName(id: string | undefined) {
  return id ? id.slice(id.indexOf("/") + 1) : "The chosen model";
}


function MessageRow({
  message,
  projectId,
  isLast,
  onRegenerate,
  onApprove,
  onEdit,
  onDelete,
}: {
  message: ChatMessage;

  // Which project a file link downloads from.
  projectId?: string | null;

  isLast: boolean;
  onRegenerate?: () => void;
  onApprove?: (
    approval: ApprovalRequest
  ) => void;

  // Absent while a message is still being
  // written, or when it has no row yet - there
  // is nothing on the server to change.
  onEdit?: (content: string) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);

  // A message that just arrived - sent from here, a reply
  // being written, or a teammate's from the last few
  // seconds - rises in. One already in the history when
  // the channel opened simply appears. Decided once, when
  // the row first mounts.
  const [enter] = useState(() =>
    !message.id ||
    (message.created_at !== undefined &&
      Date.now() - Date.parse(message.created_at) < 10_000)
      ? "t-rise "
      : ""
  );

  const [editing, setEditing] = useState(false);

  const [draft, setDraft] = useState("");

  const [busy, setBusy] = useState(false);

  async function saveEdit() {
    const text = draft.trim();

    if (!text || !onEdit || busy) {
      return;
    }

    setBusy(true);

    try {
      await onEdit(text);

      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  const isYou = message.sender === "you";

  const isTeammate =
    message.sender === "teammate";

  async function copy() {
    try {
      await navigator.clipboard.writeText(
        message.content
      );

      setCopied(true);

      setTimeout(
        () => setCopied(false),
        1600
      );
    } catch {
      // Clipboard permission can be denied.
    }
  }


  // ----------------------------------------
  // YOU
  // ----------------------------------------
  //
  // Only your own messages sit on the right.
  // Everyone else - teammates and the agent -
  // reads down the left, which is what makes a
  // conversation scannable.

  if (isYou) {
    // Editing replaces the bubble rather than
    // opening anything: the text stays where it
    // was, at the size it was, so the correction
    // happens in place.

    if (editing) {
      return (
        <div className={`${enter}flex justify-end`}>
          <div className="w-full max-w-[min(42rem,92%)] sm:max-w-[min(42rem,85%)]">
            <textarea
              autoFocus
              rows={3}
              value={draft}
              disabled={busy}
              onChange={(event) =>
                setDraft(event.target.value)
              }
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setEditing(false);
                }

                if (
                  event.key === "Enter" &&
                  !event.shiftKey
                ) {
                  event.preventDefault();

                  void saveEdit();
                }
              }}
              className="w-full resize-none rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-raised)] px-4 py-2.5 text-[14px] leading-[1.6] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />

            <div className="mt-1.5 flex items-center justify-end gap-2">
              <span className="mr-auto text-[10.5px] text-[var(--text-faint)]">
                Enter saves · Escape cancels
              </span>

              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded px-2 py-1 text-[11px] text-[var(--text-muted)] transition hover:text-[var(--text)]"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={busy || !draft.trim()}
                onClick={() => void saveEdit()}
                className="rounded bg-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-[var(--bg)] transition hover:opacity-90 disabled:opacity-40"
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className={`${enter}group flex justify-end`}>
        <div className="max-w-[min(42rem,92%)] sm:max-w-[min(42rem,85%)]">
          <p className="mb-1 pr-1 text-right text-[10px] tracking-wide text-[var(--text-faint)]">
            You
          </p>

          <div className="rounded-2xl rounded-tr-md border border-[var(--border-strong)] bg-[var(--bg-raised)] px-4 py-2.5 text-[14px] leading-[1.6] text-[var(--text)]">
            {message.attachments &&
              message.attachments.length > 0 && (
                <div
                  className={
                    message.content ? "mb-2" : ""
                  }
                >
                  <AttachmentList
                    attachments={
                      message.attachments
                    }
                  />
                </div>
              )}

            {message.content && (
              <span className="whitespace-pre-wrap">
                {message.content}
              </span>
            )}
          </div>

          {/* Said out loud, because in a shared */}
          {/* channel other people have already  */}
          {/* read the first version.            */}

          {message.edited_at && (
            <p className="mt-1 pr-1 text-right text-[10px] text-[var(--text-faint)]">
              edited
            </p>
          )}

          {(onEdit || onDelete) && (
            <div className="mt-1 flex items-center justify-end gap-1 opacity-0 transition group-hover:opacity-100 [@media(hover:none)]:opacity-100 focus-within:opacity-100">
              {onEdit && (
                <button
                  type="button"
                  onClick={() => {
                    setDraft(message.content);
                    setEditing(true);
                  }}
                  className="rounded px-1.5 py-1 text-[10.5px] text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
                >
                  Edit
                </button>
              )}

              {onDelete && (
                <button
                  type="button"
                  onClick={() => void onDelete()}
                  className="rounded px-1.5 py-1 text-[10.5px] text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-red-300"
                >
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }


  // ----------------------------------------
  // TEAMMATE
  // ----------------------------------------
  //
  // Laid out like the agent, so the two sides of
  // the conversation stay visually distinct, but
  // with the person's own initial and name.

  if (isTeammate) {
    const name =
      message.sender_name || "Teammate";

    return (
      <div className={`${enter}flex gap-3`}>
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] text-[11px] font-medium text-[var(--text-muted)]">
          {name.charAt(0).toUpperCase()}
        </div>

        <div className="min-w-0 flex-1">
          <p className="mb-1.5 text-[10px] tracking-wide text-[var(--text-faint)]">
            {name}
          </p>

          {message.attachments &&
            message.attachments.length > 0 && (
              <div className="mb-2">
                <AttachmentList
                  attachments={
                    message.attachments
                  }
                />
              </div>
            )}

          {message.content && (
            <p className="text-[14px] leading-[1.6] whitespace-pre-wrap text-[var(--text)]">
              {message.content}
            </p>
          )}
        </div>
      </div>
    );
  }


  // ----------------------------------------
  // AGENT
  // ----------------------------------------

  const showCursor =
    message.streaming && !message.error;

  return (
    <div className={`${enter}group flex gap-3`}>
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--border-strong)] bg-[var(--bg-raised)] text-[11px] font-semibold text-[var(--accent)]">
        ✦
      </div>

      <div className="min-w-0 flex-1">
        <p className="mb-1.5 text-[10px] tracking-wide text-[var(--text-faint)]">
          Agent
        </p>

        {/* What this reply answers - so a reply that
            arrived out of order is readable. */}
        {message.replyToContent && (
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-[var(--text-faint)]">
            <span className="shrink-0">↩</span>
            <span className="min-w-0 truncate border-l border-[var(--border-strong)] pl-2">
              {message.replyToContent}
            </span>
          </div>
        )}

        {message.thinking && (
          <Thinking text={message.thinking} />
        )}

        {message.activity &&
          message.activity.length > 0 && (
            <ActivityTrail
              activity={message.activity}
            />
          )}

        {message.fellBackTo && message.fellBackReason === "limit-model" ? (
          <p className="mb-2 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
            {modelName(message.fellBackFrom)} hit its limit, so{" "}
            <span className="text-[var(--text)]">
              {modelName(message.fellBackTo)}
            </span>{" "}
            answered on the same key.
          </p>
        ) : message.fellBackTo && (
          <p className="mb-2 rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-[11.5px] leading-relaxed text-amber-200">
            Answered by the built-in model ({message.fellBackTo}) —{" "}
            {message.fellBackReason === "limit"
              ? "the key is over its limit on every model it has. Per-minute limits clear within a minute; a free Gemini key's daily limits reset at midnight Pacific time (around 12:30–1:30 pm in India)."
              : message.fellBackReason === "plan"
              ? "the chosen model is not included in this project's plan."
              : message.fellBackReason === "budget"
                ? "the project's shared key has reached its monthly limit."
                : "the chosen model had no key behind it, yours or the project's."}
          </p>
        )}

        {message.error ? (
          <div className="rounded-xl border border-rose-900/50 bg-rose-950/30 px-4 py-3 text-[13px] text-rose-200">
            {message.error}
          </div>
        ) : message.content ? (
          <div className="relative">
            <Markdown
              content={message.content}
            />

            {showCursor && (
              <span className="ml-0.5 inline-block h-[14px] w-[7px] translate-y-[2px] animate-pulse bg-[var(--accent)]" />
            )}
          </div>
        ) : (
          message.streaming && (
            <div className="flex items-center gap-1.5 py-1">
              {[0, 1, 2].map((dot) => (
                <span
                  key={dot}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--text-faint)]"
                  style={{
                    animationDelay: `${dot * 140}ms`,
                  }}
                />
              ))}
            </div>
          )
        )}

        {/* ------------------------------- */}
        {/* APPROVAL                        */}
        {/* ------------------------------- */}

        {message.approvals?.map((approval) => (
          <div
            key={`${approval.tool}:${approval.filename}`}
            className="mt-3 rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2.5"
          >
            <p className="text-[12.5px] text-amber-200">
              Wants to{" "}
              <span className="font-medium">
                {approval.label.toLowerCase()}
              </span>
              . This cannot be undone.
            </p>

            {/* Only for someone who can act on it -
                a viewer sees the request, not the
                button. */}
            {onApprove && (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() =>
                  onApprove(approval)
                }
                className="rounded-md bg-amber-600/90 px-2.5 py-1 text-[11.5px] font-medium text-white transition hover:bg-amber-500"
              >
                Approve
              </button>

              <span className="self-center text-[11px] text-[var(--text-faint)]">
                Ignore it and nothing happens.
              </span>
            </div>
            )}
          </div>
        ))}

        {message.stopped && (
          <p className="mt-2 text-[11px] text-[var(--text-faint)]">
            Stopped by you.
          </p>
        )}

        {message.file && (
          <a
            href={`/api/files/${encodeURIComponent(
              message.file
            )}?projectId=${encodeURIComponent(
              message.projectId ?? projectId ?? ""
            )}`}
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-raised)] px-3 py-2 text-[12px] font-medium text-[var(--text)] transition hover:border-[var(--border-strong)] hover:text-white"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              className="h-4 w-4 text-[var(--accent)]"
            >
              <path
                d="M12 4v12m0 0 4-4m-4 4-4-4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M5 19h14"
                strokeLinecap="round"
              />
            </svg>

            {message.file}
          </a>
        )}

        {/* A page the agent made can be seen right here. */}
        {canPreview(message.file) && (
          <FilePreview
            filename={message.file!}
            projectId={message.projectId ?? projectId ?? ""}
          />
        )}


        {/* ------------------------------- */}
        {/* ROW ACTIONS                     */}
        {/* ------------------------------- */}

        {!message.streaming &&
          message.content && (
            <div className="mt-2 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 [@media(hover:none)]:opacity-100 focus-within:opacity-100">
              <button
                type="button"
                onClick={copy}
                className="rounded px-1.5 py-1 text-[10.5px] text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
              >
                {copied ? "Copied" : "Copy"}
              </button>

              {isLast && onRegenerate && (
                <button
                  type="button"
                  onClick={onRegenerate}
                  className="rounded px-1.5 py-1 text-[10.5px] text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
                >
                  Regenerate
                </button>
              )}

              {/* No Edit here. Nobody rewrites */}
              {/* what the agent said - that     */}
              {/* would make the transcript      */}
              {/* worthless as a record of what  */}
              {/* it actually answered. Deleting */}
              {/* a wrong reply is fair; putting */}
              {/* words in its mouth is not.     */}

              {onDelete && (
                <button
                  type="button"
                  onClick={() => void onDelete()}
                  className="rounded px-1.5 py-1 text-[10.5px] text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-red-300"
                >
                  Delete
                </button>
              )}

              {message.usage && (
                <span className="ml-1 text-[10px] text-[var(--text-faint)]">
                  {message.usage.responseTokens}{" "}
                  tokens ·{" "}
                  {(
                    message.usage.ms / 1000
                  ).toFixed(1)}
                  s
                </span>
              )}
            </div>
          )}
      </div>
    </div>
  );
}


// ==========================================
// WHY THIS IS MEMOISED
// ==========================================
//
// A streamed reply updates one message per token, and
// the parent re-renders the whole list each time. Every
// other row's `message` keeps its reference (patchMessage
// replaces only the streaming one), so those rows have
// nothing new to show - yet without this they all re-run
// and re-parse their Markdown on every token, which is
// what made a long conversation lag as a reply came in.
//
// The callbacks are fresh closures each render (they
// close over `message`), so their identity is ignored on
// purpose - only their presence changes what the row
// shows. Comparing the message reference is safe: a row
// is skipped only while its message is unchanged, which
// is only while the channel (and so the project the
// callbacks close over) is unchanged too.

function sameRow(
  prev: Parameters<typeof MessageRow>[0],
  next: Parameters<typeof MessageRow>[0]
) {
  return (
    prev.message === next.message &&
    prev.isLast === next.isLast &&
    prev.projectId === next.projectId &&
    Boolean(prev.onRegenerate) === Boolean(next.onRegenerate) &&
    Boolean(prev.onEdit) === Boolean(next.onEdit) &&
    Boolean(prev.onDelete) === Boolean(next.onDelete) &&
    Boolean(prev.onApprove) === Boolean(next.onApprove)
  );
}


export default memo(MessageRow, sameRow);
