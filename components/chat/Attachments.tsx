"use client";

import { useState } from "react";

import { Close, Download } from "@/components/ui/Icons";


// ==========================================
// ATTACHMENTS
// ==========================================

export type Attachment = {
  id: string;
  filename: string;
  mime: string;
  size_bytes: number;
  kind: string;
  truncated: boolean;
  note: string | null;
};


export function formatSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}


function kindLabel(kind: string) {
  if (kind === "pdf") return "PDF";
  if (kind === "docx") return "DOC";
  if (kind === "image") return "IMG";
  if (kind === "text") return "TXT";

  return "FILE";
}


// ==========================================
// CHIP
// ==========================================
//
// One attached file. Says when the agent cannot
// read it, because a silent failure here looks
// exactly like the model ignoring you.
//

export function AttachmentChip({
  attachment,
  onRemove,
  uploading,
}: {
  attachment: Attachment;
  onRemove?: () => void;
  uploading?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  const unreadable =
    attachment.kind === "image" ||
    attachment.kind === "other" ||
    Boolean(attachment.note);

  async function open() {
    setBusy(true);

    try {
      const response = await fetch(
        `/api/attachments?id=${attachment.id}`
      );

      const data = await response.json();

      if (data.url) {
        window.open(
          data.url,
          "_blank",
          "noopener"
        );
      }
    } catch {
      // A failed link is not worth a dialog.
    } finally {
      setBusy(false);
    }
  }

  return (
    <span
      className="group/chip inline-flex max-w-full items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] py-1 pr-1 pl-2 text-[11.5px]"
      title={
        attachment.note ??
        (attachment.truncated
          ? "Only the beginning of this file was read."
          : undefined)
      }
    >
      <span className="shrink-0 font-mono text-[9px] tracking-wide text-[var(--text-faint)]">
        {kindLabel(attachment.kind)}
      </span>

      <button
        type="button"
        onClick={open}
        disabled={busy || uploading}
        className="min-w-0 truncate text-[var(--text)] transition hover:text-[var(--accent)] disabled:opacity-60"
      >
        {attachment.filename}
      </button>

      <span className="shrink-0 text-[var(--text-faint)]">
        {uploading
          ? "uploading…"
          : formatSize(attachment.size_bytes)}
      </span>

      {unreadable && !uploading && (
        <span
          className="shrink-0 text-amber-500"
          aria-label="The agent cannot read this file"
        >
          !
        </span>
      )}

      {attachment.truncated && !uploading && (
        <span
          className="shrink-0 text-amber-500"
          aria-label="Only partly read"
        >
          ⋯
        </span>
      )}

      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${attachment.filename}`}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
        >
          <Close className="h-3 w-3" />
        </button>
      ) : (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--text-faint)]">
          <Download className="h-3 w-3" />
        </span>
      )}
    </span>
  );
}


// ==========================================
// LIST
// ==========================================

export function AttachmentList({
  attachments,
  onRemove,
  uploadingIds,
}: {
  attachments: Attachment[];
  onRemove?: (id: string) => void;
  uploadingIds?: string[];
}) {
  if (attachments.length === 0) {
    return null;
  }

  // Anything the agent will not be able to read.
  // Said out loud rather than left to a tooltip:
  // a file that looks attached and is silently
  // ignored is the worst of the options.

  const problems = attachments.filter(
    (attachment) =>
      attachment.note &&
      !uploadingIds?.includes(attachment.id)
  );

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {attachments.map((attachment) => (
          <AttachmentChip
            key={attachment.id}
            attachment={attachment}
            uploading={uploadingIds?.includes(
              attachment.id
            )}
            onRemove={
              onRemove
                ? () => onRemove(attachment.id)
                : undefined
            }
          />
        ))}
      </div>

      {problems.map((attachment) => (
        <p
          key={`note-${attachment.id}`}
          className="flex gap-1.5 px-0.5 text-[11px] leading-relaxed text-amber-500/90"
        >
          <span aria-hidden="true">!</span>

          <span>
            <span className="text-[var(--text-muted)]">
              {attachment.filename}
            </span>{" "}
            {attachment.note}
          </span>
        </p>
      ))}
    </div>
  );
}
