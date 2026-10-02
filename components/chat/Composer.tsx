"use client";

import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";

import {
  ArrowUp,
  Paperclip,
  Stop,
} from "@/components/ui/Icons";

import {
  AttachmentList,
  type Attachment,
} from "./Attachments";

import ModelChip from "./ModelChip";

import {
  AGENT_HANDLE,
  AGENT_ID,
  displayName,
  findMentioned,
  handlesFor,
  mentionsAgent,
  type Mentionable,
} from "@/lib/mentions";


// The handle being typed, when the caret sits
// at the end of one.

const MENTION_AT_CARET =
  /(?:^|\s)@([a-z0-9._-]*)$/i;


// ==========================================
// COMPOSER
// ==========================================
//
// A single quiet field: one hairline border on
// the page background, with the meta line under
// it rather than inside a second raised surface.
//
// Enter sends, Shift+Enter starts a new line.
//

export default function Composer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  status,
  disabled,
  placeholder,
  attachments = [],
  uploadingIds = [],
  onAttach,
  onRemoveAttachment,
  members = [],

  modelChannelId,
  modelProjectId,
  showModel = false,
  modelsToken,
  onOpenModelSettings,
  contextTokens,
  lastTurnTokens,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  status: string;
  disabled: boolean;
  placeholder: string;

  // Optional so the DM view can reuse the
  // composer without gaining file uploads.
  attachments?: Attachment[];
  uploadingIds?: string[];
  onAttach?: (files: File[]) => void;
  onRemoveAttachment?: (id: string) => void;

  // People who can be mentioned here.
  members?: Mentionable[];

  // The model chip. Off by default, so the DM
  // view reuses this composer without one - a
  // direct message has no agent to pick a model
  // for.
  showModel?: boolean;
  modelChannelId?: string | null;
  modelProjectId?: string | null;
  modelsToken?: number;

  // Where the usage panel's "Keys and limits"
  // goes.
  onOpenModelSettings?: () => void;
  contextTokens?: number;
  lastTurnTokens?: number;
}) {
  const fileInputRef =
    useRef<HTMLInputElement>(null);

  const [dragging, setDragging] =
    useState(false);

  // The "@" being typed right now, if any, and
  // which suggestion is highlighted.

  const [mentionQuery, setMentionQuery] =
    useState<string | null>(null);

  const [mentionIndex, setMentionIndex] =
    useState(0);
  const textareaRef =
    useRef<HTMLTextAreaElement>(null);


  // Grow with the text, up to a ceiling.
  //
  // Only measure when the field actually has a
  // width. Measured at zero width every character
  // wraps onto its own line, so a single sentence
  // reports hundreds of pixels, the height sticks
  // at the ceiling, and nothing re-runs to correct
  // it. A hidden tab or the first paint is enough
  // to hit that.

  useEffect(() => {
    const element = textareaRef.current;

    if (!element) {
      return;
    }

    function resize() {
      if (!element || element.clientWidth === 0) {
        return;
      }

      element.style.height = "auto";

      element.style.height = `${Math.min(
        element.scrollHeight,
        200
      )}px`;
    }

    resize();

    // Re-run once the field has been given a
    // width, and whenever that width changes.

    const observer = new ResizeObserver(resize);

    observer.observe(element);

    return () => observer.disconnect();
  }, [value, attachments.length]);


  // Focus the composer on "/" from anywhere.

  useEffect(() => {
    function onKey(
      event: globalThis.KeyboardEvent
    ) {
      if (
        event.key === "/" &&
        document.activeElement?.tagName !==
          "TEXTAREA" &&
        document.activeElement?.tagName !== "INPUT"
      ) {
        event.preventDefault();

        textareaRef.current?.focus();
      }
    }

    window.addEventListener("keydown", onKey);

    return () =>
      window.removeEventListener(
        "keydown",
        onKey
      );
  }, []);


  function handleKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>
  ) {
    // While the picker is open it owns the keys
    // that would otherwise send the message.

    if (suggestions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();

        setMentionIndex(
          (index) =>
            (index + 1) % suggestions.length
        );

        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();

        setMentionIndex(
          (index) =>
            (index - 1 + suggestions.length) %
            suggestions.length
        );

        return;
      }

      if (
        event.key === "Enter" ||
        event.key === "Tab"
      ) {
        event.preventDefault();

        pick(suggestions[mentionIndex]);

        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();

        setMentionQuery(null);

        return;
      }
    }

    // On a touch keyboard there is no Shift, and
    // Return means a new line, as it does in every
    // messaging app - sending is the button.

    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !window.matchMedia("(hover: none) and (pointer: coarse)").matches
    ) {
      event.preventDefault();

      onSend();
    }
  }

  // ----------------------------------------
  // MENTIONS
  // ----------------------------------------

  const handles = handlesFor(members);

  // The agent is offered alongside the people, so
  // asking it for something in a conversation
  // with teammates is a mention like any other.

  const agentEntry: Mentionable = {
    id: AGENT_ID,
    email: AGENT_HANDLE,
    display_name: "Agent",
  };

  handles.set(AGENT_ID, AGENT_HANDLE);

  const mentionable = [agentEntry, ...members];

  const suggestions =
    mentionQuery === null
      ? []
      : mentionable
          .filter((member) => {
            const handle =
              handles.get(member.id) ?? "";

            const query =
              mentionQuery.toLowerCase();

            return (
              handle.startsWith(query) ||
              displayName(member)
                .toLowerCase()
                .includes(query)
            );
          })
          .slice(0, 6);


  // Only the "@word" immediately before the caret
  // counts, and only at a word boundary, so an
  // email address does not open the picker.

  function readMention(
    element: HTMLTextAreaElement
  ) {
    const upToCaret = element.value.slice(
      0,
      element.selectionStart ?? 0
    );

    const match = MENTION_AT_CARET.exec(upToCaret);

    setMentionQuery(match ? match[1] : null);

    setMentionIndex(0);
  }


  function pick(member: Mentionable) {
    const element = textareaRef.current;

    if (!element) {
      return;
    }

    const caret = element.selectionStart ?? 0;

    const before = value.slice(0, caret);

    const start = before.lastIndexOf("@");

    if (start < 0) {
      return;
    }

    const handle = handles.get(member.id) ?? "";

    onChange(
      before.slice(0, start) +
        "@" +
        handle +
        " " +
        value.slice(caret)
    );

    setMentionQuery(null);

    // Put the caret after what was just inserted.

    requestAnimationFrame(() => {
      const position = start + handle.length + 2;

      element.focus();

      element.setSelectionRange(position, position);
    });
  }


  // Who this message is addressed to, if anyone.
  // Worth saying before it is sent rather than
  // leaving the missing reply to be puzzled over.

  const mentioned = findMentioned(value, members)
    .map((id) => {
      const member = members.find(
        (candidate) => candidate.id === id
      );

      return member
        ? displayName(member).split(/\s+/)[0]
        : null;
    })
    .filter((name): name is string =>
      Boolean(name)
    );

  const asksAgent = mentionsAgent(value);


  // A file on its own is worth sending: "have a
  // look at this" is a complete thought.

  const canSend =
    (value.trim() !== "" ||
      attachments.length > 0) &&
    !streaming &&
    !disabled;

  const canAttach =
    Boolean(onAttach) && !disabled;


  function take(files: FileList | null) {
    if (!files || files.length === 0 || !onAttach) {
      return;
    }

    onAttach(Array.from(files));
  }


  function onDrop(event: DragEvent) {
    event.preventDefault();

    setDragging(false);

    if (canAttach) {
      take(event.dataTransfer.files);
    }
  }


  function onPaste(
    event: ClipboardEvent<HTMLTextAreaElement>
  ) {
    if (!canAttach) {
      return;
    }

    const files = Array.from(
      event.clipboardData.files
    );

    if (files.length > 0) {
      event.preventDefault();

      onAttach?.(files);
    }
  }

  return (
    <div className="shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-4">
      <div className="relative mx-auto max-w-3xl">

        {/* ------------------------------ */}
        {/* MENTION PICKER                 */}
        {/* ------------------------------ */}

        {suggestions.length > 0 && (
          <div className="absolute bottom-full left-0 z-30 mb-2 w-64 overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--bg-raised)] py-1 shadow-xl shadow-black/40">
            {suggestions.map((member, index) => (
              <button
                key={member.id}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();

                  pick(member);
                }}
                onMouseEnter={() =>
                  setMentionIndex(index)
                }
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition ${
                  index === mentionIndex
                    ? "bg-[var(--bg-hover)]"
                    : ""
                }`}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--bg-panel)] text-[9px] font-medium text-[var(--text-muted)]">
                  {displayName(member)
                    .charAt(0)
                    .toUpperCase()}
                </span>

                <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text)]">
                  {displayName(member)}
                </span>

                <span className="shrink-0 font-mono text-[10.5px] text-[var(--text-faint)]">
                  @{handles.get(member.id)}
                </span>
              </button>
            ))}
          </div>
        )}


        {/* ------------------------------ */}
        {/* FIELD                          */}
        {/* ------------------------------ */}

        <div
          onDragOver={(event) => {
            if (canAttach) {
              event.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`rounded-xl border px-3 py-2 transition-colors ${
            dragging
              ? "border-[var(--accent)]"
              : "border-[var(--border)] focus-within:border-[var(--border-strong)]"
          }`}
        >
          {attachments.length > 0 && (
            <div className="pt-1 pb-2">
              <AttachmentList
                attachments={attachments}
                uploadingIds={uploadingIds}
                onRemove={onRemoveAttachment}
              />
            </div>
          )}

          <div className="flex items-end gap-2">
          {canAttach && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(event) => {
                  take(event.target.files);
                  event.target.value = "";
                }}
              />

              <button
                type="button"
                onClick={() =>
                  fileInputRef.current?.click()
                }
                title="Attach a file"
                aria-label="Attach a file"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] sm:mb-0.5 sm:h-6 sm:w-6"
              >
                <Paperclip className="h-3.5 w-3.5" />
              </button>
            </>
          )}

          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(event) => {
              onChange(event.target.value);

              readMention(event.target);
            }}
            onKeyUp={(event) =>
              readMention(event.currentTarget)
            }
            onBlur={() =>
              setTimeout(
                () => setMentionQuery(null),
                120
              )
            }
            onKeyDown={handleKeyDown}
            onPaste={onPaste}
            className="max-h-[200px] min-h-[28px] flex-1 resize-none bg-transparent py-1 text-[16px] leading-[1.5] text-[var(--text)] outline-none sm:text-[14px] placeholder:text-[var(--text-faint)] disabled:opacity-40"
          />

          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              title="Stop generating"
              aria-label="Stop generating"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition sm:mb-0.5 sm:h-6 sm:w-6 hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
            >
              <Stop className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onSend}
              disabled={!canSend}
              title="Send"
              aria-label="Send"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:pointer-events-none sm:mb-0.5 sm:h-6 sm:w-6 disabled:opacity-30"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
          )}
          </div>
        </div>


        {/* ------------------------------ */}
        {/* META                           */}
        {/* ------------------------------ */}

        <div className="mt-1.5 flex h-4 items-center gap-2 px-1">
          {streaming ? (
            <>
              <span className="h-1 w-1 animate-pulse rounded-full bg-[var(--accent)]" />

              <span className="text-[11px] text-[var(--text-muted)]">
                {status || "Working"}
              </span>
            </>
          ) : (
            <span
              className={`min-w-0 truncate text-[10.5px] text-[var(--text-faint)] ${
                mentioned.length > 0 || dragging ? "" : "hidden sm:inline"
              }`}
            >
              {dragging
                ? "Drop to attach"
                : mentioned.length > 0
                  ? asksAgent
                    ? `Goes to ${mentioned.join(
                        " and "
                      )} · the agent will reply`
                    : `Goes to ${mentioned.join(
                        " and "
                      )} · the agent stays out`
                  : canAttach
                    ? "Enter to send · Shift+Enter for a new line · drop or paste files"
                    : "Enter to send · Shift+Enter for a new line"}
            </span>
          )}

          {/* Which model answers, and what the */}
          {/* conversation is costing. Same row */}
          {/* because both are things worth     */}
          {/* knowing before pressing Enter.    */}

          {showModel && (
            <ModelChip
              channelId={modelChannelId}
              projectId={modelProjectId}
              refreshToken={modelsToken}
              contextTokens={contextTokens}
              lastTurnTokens={lastTurnTokens}
              onOpenSettings={onOpenModelSettings}
            />
          )}
        </div>
      </div>
    </div>
  );
}
