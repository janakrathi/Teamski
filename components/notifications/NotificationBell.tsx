"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { createClient } from "@/lib/supabase/client";

import { Bell } from "@/components/ui/Icons";


// ==========================================
// NOTIFICATIONS
// ==========================================
//
// A shared workspace that never tells you
// anything happened is a workspace people stop
// opening. This is the one place that does.
//

type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  project_id: string | null;
  channel_id: string | null;
  message_id: string | null;
  read_at: string | null;
  created_at: string;
};


function ago(iso: string) {
  const seconds = Math.floor(
    (Date.now() - new Date(iso).getTime()) / 1000
  );

  if (seconds < 60) return "just now";

  if (seconds < 3600)
    return `${Math.floor(seconds / 60)}m ago`;

  if (seconds < 86400)
    return `${Math.floor(seconds / 3600)}h ago`;

  return `${Math.floor(seconds / 86400)}d ago`;
}


export default function NotificationBell({
  onOpenChannel,
}: {
  onOpenChannel?: (channelId: string) => void;
}) {
  const [items, setItems] = useState<
    Notification[]
  >([]);

  const [unread, setUnread] = useState(0);

  const [open, setOpen] = useState(false);

  const [missing, setMissing] = useState(false);

  const containerRef =
    useRef<HTMLDivElement>(null);


  const load = useCallback(async () => {
    try {
      const response = await fetch(
        "/api/notifications",
        { cache: "no-store" }
      );

      const data = await response.json();

      if (!response.ok) {
        // Without the migration there is nothing
        // to show; stay quiet rather than nag.

        setMissing(
          Boolean(data.needsMigration)
        );

        return;
      }

      setMissing(false);
      setItems(data.notifications ?? []);
      setUnread(data.unread ?? 0);
    } catch {
      // A failed poll corrects itself.
    }
  }, []);


  useEffect(() => {
    void load();

    // New ones arrive as they are written, with a
    // slow poll behind it so a missed event
    // cannot leave the count wrong forever.

    const supabase = createClient();

    const channel = supabase
      .channel("notifications")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
        },
        () => {
          void load();
        }
      )
      .subscribe();

    const timer = setInterval(
      () => void load(),
      30_000
    );

    return () => {
      supabase.removeChannel(channel);
      clearInterval(timer);
    };
  }, [load]);


  // Close when clicking away.

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(
          event.target as Node
        )
      ) {
        setOpen(false);
      }
    }

    document.addEventListener(
      "mousedown",
      onPointerDown
    );

    return () =>
      document.removeEventListener(
        "mousedown",
        onPointerDown
      );
  }, [open]);


  async function markRead(id?: string) {
    setItems((previous) =>
      previous.map((item) =>
        !id || item.id === id
          ? {
              ...item,
              read_at:
                item.read_at ??
                new Date().toISOString(),
            }
          : item
      )
    );

    setUnread((previous) =>
      id ? Math.max(0, previous - 1) : 0
    );

    await fetch("/api/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(id ? { id } : {}),
    });
  }


  function openOne(item: Notification) {
    void markRead(item.id);

    if (item.channel_id && onOpenChannel) {
      onOpenChannel(item.channel_id);
    }

    setOpen(false);
  }


  if (missing) {
    return null;
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={
          unread > 0
            ? `${unread} unread notifications`
            : "Notifications"
        }
        title="Notifications"
        className="relative flex h-6 w-6 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-faint)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-muted)]"
      >
        <Bell className="h-3.5 w-3.5" />

        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[9px] font-medium text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div data-origin="top-right" className="t-dropdown absolute top-full right-0 z-40 mt-2 w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--bg-raised)] shadow-xl shadow-black/40">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
            <span className="text-[11px] tracking-[0.12em] text-[var(--text-faint)] uppercase">
              Notifications
            </span>

            {unread > 0 && (
              <button
                type="button"
                onClick={() => markRead()}
                className="text-[11px] text-[var(--text-faint)] transition hover:text-[var(--accent)]"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-4 text-[12.5px] text-[var(--text-faint)]">
                Nothing yet. Mentions and finished
                agent runs land here.
              </p>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openOne(item)}
                  className={`flex w-full gap-2.5 border-b border-[var(--border)] px-3 py-2.5 text-left transition last:border-0 hover:bg-[var(--bg-hover)] ${
                    item.read_at
                      ? "opacity-60"
                      : ""
                  }`}
                >
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      item.read_at
                        ? "bg-transparent"
                        : "bg-[var(--accent)]"
                    }`}
                  />

                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] text-[var(--text)]">
                      {item.title}
                    </span>

                    {item.body && (
                      <span className="mt-0.5 block truncate text-[11.5px] text-[var(--text-muted)]">
                        {item.body}
                      </span>
                    )}

                    <span className="mt-0.5 block text-[10.5px] text-[var(--text-faint)]">
                      {ago(item.created_at)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
