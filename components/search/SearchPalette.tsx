"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  Hash,
  Search as SearchIcon,
} from "@/components/ui/Icons";

import type { Channel } from "@/components/types";

import { usePresence } from "@/lib/ui/usePresence";


// ==========================================
// SEARCH PALETTE
// ==========================================
//
// Ctrl+K over the current project's messages and
// channels. Picking a message jumps to the
// channel it was said in.
//

type Hit = {
  kind: "message" | "channel";
  id: string;
  channelId: string | null;
  channelName: string | null;
  role: string | null;
  content: string;
  createdAt: string | null;
};


// Show the match in place rather than the start
// of the message, which is often not the part
// that matched.

function excerpt(text: string, query: string) {
  const index = text
    .toLowerCase()
    .indexOf(query.toLowerCase());

  if (index < 0) {
    return text.slice(0, 140);
  }

  const from = Math.max(0, index - 40);

  return (
    (from > 0 ? "…" : "") +
    text.slice(from, from + 150).trim() +
    (from + 150 < text.length ? "…" : "")
  );
}


function Highlight({
  text,
  query,
}: {
  text: string;
  query: string;
}) {
  const index = text
    .toLowerCase()
    .indexOf(query.toLowerCase());

  if (index < 0 || !query) {
    return <>{text}</>;
  }

  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded bg-[var(--accent-soft)] px-0.5 text-[var(--accent)]">
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  );
}


export default function SearchPalette({
  open,
  onClose,
  projectId,
  channels,
  onGoToChannel,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string | null;
  channels: Channel[];
  onGoToChannel: (channel: Channel) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);

  const inputRef =
    useRef<HTMLInputElement>(null);


  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    } else {
      setQuery("");
      setHits([]);
      setSelected(0);
    }
  }, [open]);


  // Debounced, so typing does not fire a request
  // per keystroke.

  useEffect(() => {
    if (!open || !projectId) {
      return;
    }

    const text = query.trim();

    if (text.length < 2) {
      setHits([]);

      return;
    }

    let cancelled = false;

    const timer = setTimeout(async () => {
      setLoading(true);

      try {
        const response = await fetch(
          `/api/search?projectId=${projectId}&q=${encodeURIComponent(
            text
          )}`,
          { cache: "no-store" }
        );

        const data = await response.json();

        if (!cancelled) {
          setHits(data.hits ?? []);
          setSelected(0);
        }
      } catch {
        // An empty result is a fine failure mode.
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open, projectId]);


  function choose(hit: Hit) {
    const channel = channels.find(
      (item) => item.id === hit.channelId
    );

    if (channel) {
      onGoToChannel(channel);
    }

    onClose();
  }


  function onKeyDown(
    event: React.KeyboardEvent
  ) {
    if (event.key === "Escape") {
      onClose();

      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();

      setSelected((index) =>
        Math.min(index + 1, hits.length - 1)
      );
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();

      setSelected((index) =>
        Math.max(index - 1, 0)
      );
    }

    if (event.key === "Enter" && hits[selected]) {
      choose(hits[selected]);
    }
  }


  // Kept on screen for its close (lib/ui/usePresence.ts).
  const presence = usePresence(open);

  if (!presence.mounted) {
    return null;
  }

  const leaving = presence.closing ? " is-closing" : "";

  return (
    <div className={`fixed inset-0 z-50 flex items-start justify-center pt-3 sm:pt-[12vh]${presence.closing ? " pointer-events-none" : ""}`}>
      <button
        type="button"
        aria-label="Close search"
        onClick={onClose}
        className={`t-overlay${leaving} absolute inset-0 bg-black/60`}
      />

      <div
        className={`t-palette${leaving} relative w-[min(640px,92vw)] overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--bg-raised)] shadow-2xl shadow-black/50`}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--border)] px-4">
          <SearchIcon className="h-4 w-4 shrink-0 text-[var(--text-faint)]" />

          <input
            ref={inputRef}
            value={query}
            onChange={(event) =>
              setQuery(event.target.value)
            }
            placeholder="Search messages and channels"
            className="min-w-0 flex-1 bg-transparent py-3.5 text-[16px] sm:text-[14px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
          />

          <kbd className="shrink-0 rounded border border-[var(--border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-faint)]">
            esc
          </kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto py-1">
          {query.trim().length < 2 ? (
            <p className="px-4 py-3 text-[12.5px] text-[var(--text-faint)]">
              Type at least two characters.
            </p>
          ) : loading && hits.length === 0 ? (
            <p className="px-4 py-3 text-[12.5px] text-[var(--text-faint)]">
              Searching…
            </p>
          ) : hits.length === 0 ? (
            <p className="px-4 py-3 text-[12.5px] text-[var(--text-faint)]">
              Nothing matched “{query.trim()}”.
            </p>
          ) : (
            hits.map((hit, index) => (
              <button
                key={`${hit.kind}-${hit.id}`}
                type="button"
                onClick={() => choose(hit)}
                onMouseEnter={() =>
                  setSelected(index)
                }
                className={`flex w-full items-start gap-2.5 px-4 py-2 text-left transition ${
                  index === selected
                    ? "bg-[var(--bg-hover)]"
                    : ""
                }`}
              >
                <Hash className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" />

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-[var(--text)]">
                    <Highlight
                      text={excerpt(
                        hit.content,
                        query.trim()
                      )}
                      query={query.trim()}
                    />
                  </span>

                  <span className="mt-0.5 block text-[11px] text-[var(--text-faint)]">
                    {hit.kind === "channel"
                      ? "Channel"
                      : [
                          hit.channelName
                            ? `#${hit.channelName}`
                            : "Project",
                          hit.role === "assistant"
                            ? "Agent"
                            : "You",
                          hit.createdAt
                            ? new Date(
                                hit.createdAt
                              ).toLocaleDateString()
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
