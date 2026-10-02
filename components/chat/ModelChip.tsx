"use client";

import UsageRing from "./UsageRing";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";


// ==========================================
// WHICH MODEL, FROM THE COMPOSER
// ==========================================
//
// The model is a per-message decision, so asking
// people to open Settings for it was wrong. It
// belongs where the message is written, next to
// what the last one cost.
//
// Two things sit here because they are the two
// facts you want before pressing Enter: what is
// answering, and how much of the window is left.
//

type Model = {
  id: string;
  label: string;
  costPerMTokIn?: number;
  costPerMTokOut?: number;
  contextWindow?: number;
};

type Group = {
  service: string;
  label: string;
  local: boolean;
  models: Model[];
};


export default function ModelChip({
  channelId,
  projectId,
  refreshToken = 0,

  // How much of the window the conversation is
  // currently taking, and what the last reply
  // cost. Both absent until the first answer.
  contextTokens,
  lastTurnTokens,
  onOpenSettings,
}: {
  // Opens Settings on the AI tab, for keys and
  // limits.
  onOpenSettings?: () => void;

  // In a channel the choice is the channel's and
  // everyone sees it change. Outside one it is
  // yours, kept on your profile.
  channelId?: string | null;

  // Decides whether the project's shared models
  // are on offer.
  projectId?: string | null;

  refreshToken?: number;
  contextTokens?: number;
  lastTurnTokens?: number;
}) {
  // The chosen model comes from settings, which
  // live in localStorage - so the server renders
  // one label and the browser renders another,
  // and React calls that a hydration failure.
  //
  // false while rendering on the server and
  // through hydration, true once the browser owns
  // the page. Until then the chip shows a fixed
  // label that both sides agree on.

  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const [groups, setGroups] = useState<Group[]>([]);

  const [value, setValue] = useState("");

  // True when changing this changes it for
  // everybody in the channel, which the menu says
  // out loud before anyone does it.

  const [shared, setShared] = useState(false);

  const [open, setOpen] = useState(false);

  const boxRef = useRef<HTMLDivElement>(null);


  // Read again every time the menu opens, as well
  // as up front: a key added in Settings, or a
  // plan that changed, has to show up here without
  // a reload.

  useEffect(() => {
    let cancelled = false;

    fetch(
      `/api/models${
        projectId ? `?projectId=${projectId}` : ""
      }`,
      { cache: "no-store" }
    )
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) {
          setGroups(data.providers ?? []);
        }
      })
      .catch(() => {
        // The chip falls back to showing the id
        // it was given.
      });

    return () => {
      cancelled = true;
    };
  }, [refreshToken, projectId, open]);


  // Which model this conversation answers with.
  // Re-read when the channel changes, because the
  // answer is a property of the channel.

  useEffect(() => {
    let cancelled = false;

    const query = channelId
      ? `?channelId=${channelId}`
      : "";

    fetch(`/api/models/choose${query}`, {
      cache: "no-store",
    })
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) {
          setValue(data.model ?? "");
          setShared(Boolean(data.shared));
        }
      })
      .catch(() => {
        // Falls back to showing the local
        // default, which is what it would use.
      });

    return () => {
      cancelled = true;
    };
  }, [channelId, refreshToken]);


  async function choose(model: string) {
    // On screen first: the round trip only
    // records it.

    setValue(model);
    setShared(Boolean(channelId));
    setOpen(false);

    await fetch("/api/models/choose", {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        model,
        channelId: channelId ?? null,
      }),
    });
  }


  // Clicking anywhere else closes it, which is
  // what a menu is expected to do.

  useEffect(() => {
    if (!open) {
      return;
    }

    function away(event: MouseEvent) {
      if (
        boxRef.current &&
        !boxRef.current.contains(
          event.target as Node
        )
      ) {
        setOpen(false);
      }
    }

    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);

    return () => {
      document.removeEventListener(
        "mousedown",
        away
      );

      document.removeEventListener(
        "keydown",
        escape
      );
    };
  }, [open]);


  const all = groups.flatMap((group) =>
    group.models.map((model) => ({ model, group }))
  );

  const chosen =
    all.find(
      (entry) => entry.model.id === value
    ) ??
    all.find((entry) => entry.group.local) ??
    null;

  const hosted = ready
    ? chosen
      ? !chosen.group.local
      : false
    : false;


  // The window belongs to the model, so the chip
  // reads it from the same list it already
  // fetched rather than being told twice. The
  // usage ring does the arithmetic.

  const contextWindow =
    chosen?.model.contextWindow;


  return (
    <div
      ref={boxRef}
      className="relative ml-auto flex items-center gap-2"
    >

      {/* ---------------------------- */}
      {/* HOW MUCH IS LEFT             */}
      {/* ---------------------------- */}

      {ready && (
        <UsageRing
          projectId={projectId}
          model={chosen?.model.id ?? value}
          contextTokens={contextTokens}
          contextWindow={contextWindow}
          lastTurnTokens={lastTurnTokens}
          onOpenSettings={onOpenSettings}
        />
      )}


      {/* ---------------------------- */}
      {/* WHICH MODEL                  */}
      {/* ---------------------------- */}

      <button
        type="button"
        disabled={!ready}
        onClick={() => setOpen(!open)}
        title="Choose the model that answers"
        className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10.5px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            hosted
              ? "bg-amber-500"
              : "bg-emerald-500"
          }`}
        />

        <span className="max-w-[9rem] truncate">
          {ready
            ? (chosen?.model.label ||
              value ||
              "Model")
            : "Model"}
        </span>

        {ready && shared && (
          <span
            title="Set for this channel, so everyone here gets the same agent"
            className="text-[9.5px] text-[var(--text-faint)]"
          >
            shared
          </span>
        )}
      </button>


      {open && (
        <div className="absolute right-0 bottom-6 z-30 max-h-[19rem] w-64 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] p-1.5 shadow-2xl">
          {groups.length === 0 ? (
            <p className="px-2 py-1.5 text-[11.5px] text-[var(--text-faint)]">
              No models available.
            </p>
          ) : (
            groups.map((group) => (
              <div
                key={group.service}
                className="mb-1 last:mb-0"
              >
                <p className="flex items-center gap-1.5 px-2 py-1 text-[9.5px] tracking-[0.1em] text-[var(--text-faint)] uppercase">
                  {group.label}

                  <span
                    className={`h-1 w-1 rounded-full ${
                      group.local
                        ? "bg-emerald-500"
                        : "bg-amber-500"
                    }`}
                  />
                </p>

                {group.models.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() =>
                      void choose(model.id)
                    }
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition ${
                      model.id === chosen?.model.id
                        ? "bg-[var(--bg-hover)] text-[var(--text)]"
                        : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate text-[12px]">
                      {model.label}
                    </span>

                    {model.costPerMTokOut !==
                      undefined && (
                      <span className="shrink-0 text-[9.5px] text-[var(--text-faint)] tabular-nums">
                        {model.costPerMTokOut === 0
                          ? "Free"
                          : `$${model.costPerMTokOut}/M`}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))
          )}

          <p className="border-t border-[var(--border)] px-2 pt-1.5 pb-1 text-[10px] leading-relaxed text-[var(--text-faint)]">
            {channelId
              ? "This is the channel's agent, so changing it changes it for everyone here. Green stays on this machine; amber leaves it and bills your key, or the project's."
              : "Green stays on this machine. Amber leaves it, and bills your key."}
          </p>
        </div>
      )}
    </div>
  );
}
