"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { Close } from "@/components/ui/Icons";

import { usePresence } from "@/lib/ui/usePresence";


// ==========================================
// DIALOG
// ==========================================
//
// Naming a project, naming a channel and giving
// an agent a task were all window.prompt: an OS
// dialog in the wrong typeface, pinned to the
// top of the screen, that blocks the page and
// cannot say anything useful about what it is
// asking for.
//
// This is the same job done in the app's own
// surface. Escape closes it, the backdrop closes
// it, focus starts in the field and stays inside
// while it is open.
//

export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  wide = false,
}: {
  // Room for a grid of choices rather than one
  // field.
  wide?: boolean;

  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Whatever had focus before, so closing does
  // not dump the caret at the top of the page.

  const restoreRef = useRef<HTMLElement | null>(
    null
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    restoreRef.current =
      document.activeElement as HTMLElement | null;

    // The first field, or the panel itself if
    // this dialog is only asking to confirm.

    const first =
      panelRef.current?.querySelector<HTMLElement>(
        "input, textarea, select, button"
      );

    first?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();

        onClose();

        return;
      }

      // Keep tabbing inside. Without this, focus
      // walks off into the page behind and the
      // dialog stops being a dialog.

      if (event.key !== "Tab") {
        return;
      }

      const focusable =
        panelRef.current?.querySelectorAll<HTMLElement>(
          "input, textarea, select, button, [href], [tabindex]:not([tabindex='-1'])"
        );

      if (!focusable || focusable.length === 0) {
        return;
      }

      const list = Array.from(focusable).filter(
        (node) => !node.hasAttribute("disabled")
      );

      const first = list[0];
      const last = list[list.length - 1];

      if (
        event.shiftKey &&
        document.activeElement === first
      ) {
        event.preventDefault();

        last.focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === last
      ) {
        event.preventDefault();

        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener(
        "keydown",
        onKey
      );

      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  const { mounted, closing } = usePresence(open);

  if (!mounted) {
    return null;
  }

  const leaving = closing ? " is-closing pointer-events-none" : "";

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6${leaving}`}
      role="presentation"
      onMouseDown={(event) => {
        // Only the backdrop. Dragging a selection
        // out of a field should not close it.

        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className={`t-overlay absolute inset-0 bg-black/60 backdrop-blur-[2px]${leaving}`} />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`t-modal${leaving} relative max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-3rem)] w-full overflow-y-auto ${
          wide ? "max-w-[580px]" : "max-w-[400px]"
        } rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] shadow-2xl`}
      >
        <div className="flex items-start gap-3 px-5 pt-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-medium text-[var(--text)]">
              {title}
            </h2>

            {description && (
              <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
                {description}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            <Close className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="px-5 py-4">{children}</div>

        {footer && (
          <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}


// ==========================================
// BUTTONS
// ==========================================

export function DialogButton({
  variant = "quiet",
  ...button
}: {
  variant?: "primary" | "quiet";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...button}
      className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition disabled:opacity-50 ${
        variant === "primary"
          ? "bg-[var(--accent)] text-[var(--bg)] hover:opacity-90"
          : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
      }`}
    />
  );
}


// ==========================================
// ASKING FOR ONE THING
// ==========================================
//
// The shape window.prompt was being used for,
// with room to explain what the answer is for
// and to say what went wrong without an alert().
//

type PromptProps = {
  title: string;
  description?: string;
  label?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  multiline?: boolean;
  onSubmit: (value: string) => Promise<void> | void;
  onClose: () => void;
};


// Closed means not mounted, so the next time it
// opens it starts empty - no leftover answer and
// no leftover error - without an effect reaching
// in to reset three things by hand.

export function PromptDialog({
  open,
  ...props
}: { open: boolean } & PromptProps) {
  if (!open) {
    return null;
  }

  return <Prompt {...props} />;
}


function Prompt({
  title,
  description,
  label,
  placeholder,
  initialValue = "",
  confirmLabel = "Create",
  multiline = false,
  onSubmit,
  onClose,
}: PromptProps) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = useCallback(async () => {
    const trimmed = value.trim();

    if (!trimmed || busy) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      await onSubmit(trimmed);

      onClose();
    } catch (cause) {
      // Stay open and say so, rather than
      // closing and firing an alert at someone
      // who has already lost what they typed.

      setError(
        cause instanceof Error
          ? cause.message
          : "That did not work."
      );

      setBusy(false);
    }
  }, [value, busy, onSubmit, onClose]);

  return (
    <Dialog
      open
      title={title}
      description={description}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <DialogButton
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </DialogButton>

          <DialogButton
            type="button"
            variant="primary"
            onClick={submit}
            disabled={busy || !value.trim()}
          >
            {busy ? "Working…" : confirmLabel}
          </DialogButton>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();

          void submit();
        }}
      >
        {label && (
          <span className="mb-1.5 block text-[11px] tracking-[0.06em] text-[var(--text-faint)] uppercase">
            {label}
          </span>
        )}

        {multiline ? (
          <textarea
            rows={3}
            value={value}
            placeholder={placeholder}
            disabled={busy}
            onChange={(event) =>
              setValue(event.target.value)
            }
            onKeyDown={(event) => {
              // Enter sends, as it does in the
              // composer. Shift+Enter is a line.

              if (
                event.key === "Enter" &&
                !event.shiftKey
              ) {
                event.preventDefault();

                void submit();
              }
            }}
            className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2.5 text-[13.5px] leading-[1.5] text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--border-strong)]"
          />
        ) : (
          <input
            type="text"
            value={value}
            placeholder={placeholder}
            disabled={busy}
            onChange={(event) =>
              setValue(event.target.value)
            }
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2.5 text-[13.5px] text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--border-strong)]"
          />
        )}

        {error && (
          <p className="mt-2.5 text-[12.5px] leading-relaxed text-red-300">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
