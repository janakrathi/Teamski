"use client";

import { useState } from "react";

import { Dialog, DialogButton } from "@/components/ui/Dialog";

import { TEMPLATES } from "@/lib/agents/templates";


// ==========================================
// NEW CHANNEL
// ==========================================
//
// A name was all this used to ask for, which left
// a new channel with an agent that knew nothing
// about why the channel exists. Picking what the
// channel is for gives its agent instructions
// from the first message - and "Blank" is still
// there for somebody who wants to write their
// own.
//

export default function NewChannelDialog({
  open,
  onCreate,
  onClose,
}: {
  open: boolean;
  onCreate: (
    name: string,
    templateId: string | null
  ) => Promise<void>;
  onClose: () => void;
}) {
  if (!open) {
    return null;
  }

  // Mounted only while open, so it starts fresh
  // every time.

  return <Picker onCreate={onCreate} onClose={onClose} />;
}


function Picker({
  onCreate,
  onClose,
}: {
  onCreate: (
    name: string,
    templateId: string | null
  ) => Promise<void>;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);

  const [name, setName] = useState("");

  // Once somebody types a name, choosing another
  // template stops overwriting it.

  const [nameTouched, setNameTouched] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function choose(id: string | null) {
    setChosen(id);

    if (!nameTouched) {
      setName(
        TEMPLATES.find((template) => template.id === id)
          ?.channel ?? ""
      );
    }
  }

  async function create() {
    if (!name.trim() || busy) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      await onCreate(name.trim(), chosen);

      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not create the channel."
      );

      setBusy(false);
    }
  }

  const picked = TEMPLATES.find(
    (template) => template.id === chosen
  );

  return (
    <Dialog
      open
      wide
      title="New channel"
      description="Pick what this channel is for, and its agent starts with instructions for that job. You can change them any time in Settings."
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
            onClick={create}
            disabled={busy || !name.trim()}
          >
            {busy ? "Creating…" : "Create channel"}
          </DialogButton>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        <TemplateCard
          emoji="＃"
          title="Blank"
          tagline="A general agent. Write its instructions yourself."
          selected={chosen === null}
          onClick={() => choose(null)}
        />

        {TEMPLATES.map((template) => (
          <TemplateCard
            key={template.id}
            emoji={template.emoji}
            title={template.name}
            tagline={template.tagline}
            selected={chosen === template.id}
            onClick={() => choose(template.id)}
          />
        ))}
      </div>

      {picked?.worksBestWith && (
        <p className="mt-2 text-[11.5px] text-[var(--text-faint)]">
          Works best with: {picked.worksBestWith}
        </p>
      )}

      <form
        className="mt-3"
        onSubmit={(event) => {
          event.preventDefault();

          void create();
        }}
      >
        <span className="mb-1.5 block text-[11px] tracking-[0.06em] text-[var(--text-faint)] uppercase">
          Channel name
        </span>

        <input
          type="text"
          value={name}
          placeholder="design"
          disabled={busy}
          onChange={(event) => {
            setName(event.target.value);
            setNameTouched(true);
          }}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2.5 text-[13.5px] text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--border-strong)]"
        />

        {error && (
          <p className="mt-2.5 text-[12.5px] leading-relaxed text-red-300">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}


export function TemplateCard({
  emoji,
  title,
  tagline,
  selected,
  onClick,
}: {
  emoji: string;
  title: string;
  tagline: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition ${
        selected
          ? "border-[var(--accent)] bg-[var(--bg-raised)]"
          : "border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]"
      }`}
    >
      <span className="mt-px text-[16px] leading-none" aria-hidden="true">
        {emoji}
      </span>

      <span className="min-w-0">
        <span className="block text-[12.5px] font-medium text-[var(--text)]">
          {title}
        </span>

        <span className="mt-0.5 block text-[11.5px] leading-snug text-[var(--text-faint)]">
          {tagline}
        </span>
      </span>
    </button>
  );
}
