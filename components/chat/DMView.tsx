"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { createClient } from "@/lib/supabase/client";

import {
  cachedJson,
  peekJson,
  setJson,
} from "@/lib/net/cache";

import Composer from "./Composer";

import Markdown from "./Markdown";

import {
  AttachmentList,
  type Attachment,
} from "./Attachments";

import type { Member } from "@/components/types";

import MenuButton from "@/components/ui/MenuButton";


type DMMessage = {
  id: string;
  content: string;
  user_id: string;
  created_at: string;
  sender?: "you" | "teammate";
  attachments?: Attachment[];
  edited_at?: string | null;
};


// ------------------------------------------
// WHEN
// ------------------------------------------
//
// There was no time on a message at all. You
// could not tell whether a conversation happened
// this morning or last March.
//

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function dayOf(iso: string) {
  const date = new Date(iso);

  const today = new Date();

  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const same = (a: Date, b: Date) =>
    a.toDateString() === b.toDateString();

  if (same(date, today)) {
    return "Today";
  }

  if (same(date, yesterday)) {
    return "Yesterday";
  }

  return date.toLocaleDateString([], {
    day: "numeric",
    month: "short",

    // The year only when it is not this one.
    year:
      date.getFullYear() === today.getFullYear()
        ? undefined
        : "numeric",
  });
}


// ==========================================
// DIRECT MESSAGE VIEW
// ==========================================
//
// Opens (or reuses) the conversation with one
// teammate and keeps it live over Supabase
// realtime.
//

export default function DMView({
  member,
  onRead,
  onOpenMenu,
}: {
  member: Member;

  // Phones: opens the sidebar drawer.
  onOpenMenu?: () => void;

  // Opening a conversation is what marks it
  // read, and the sidebar count outside this
  // component is what needs to hear about it.
  onRead?: (conversationId: string) => void;
}) {
  const [conversationId, setConversationId] =
    useState<string | null>(null);

  const [messages, setMessages] = useState<
    DMMessage[]
  >([]);

  const [draft, setDraft] = useState("");

  // Files chosen but not yet sent. They upload
  // immediately, so sending is instant and the
  // text is already extracted by then.

  const [pending, setPending] = useState<
    Attachment[]
  >([]);

  const [uploadingIds, setUploadingIds] = useState<
    string[]
  >([]);

  // The message being rewritten, and what it
  // would say. Null when nothing is.

  const [editingId, setEditingId] = useState<
    string | null
  >(null);

  const [editDraft, setEditDraft] = useState("");

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<
    string | null
  >(null);

  const bottomRef =
    useRef<HTMLDivElement>(null);

  // Realtime hands over a raw row, which says
  // whose it is but not whether that is you. The
  // id comes from the first load and is stable
  // for the session.

  const meRef = useRef<string | null>(null);

  const name =
    member.display_name ||
    member.username ||
    member.email;


  // ----------------------------------------
  // OPEN THE CONVERSATION
  // ----------------------------------------

  useEffect(() => {
    let cancelled = false;

    // The conversation with a given person never
    // changes id, so once we know it we can skip the
    // round-trip that resolves it and go straight to
    // the messages (which paint from cache instantly).
    const knownConvo = peekJson<string>(
      `dmconvo:${member.id}`
    );

    // Reset through a microtask so the effect
    // body itself does not trigger a render.

    void Promise.resolve().then(() => {
      if (cancelled) {
        return;
      }

      setLoading(true);
      setError(null);
      setMessages([]);
      setConversationId(knownConvo ?? null);
    });

    if (knownConvo) {
      return () => {
        cancelled = true;
      };
    }

    fetch("/api/dms", {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        user_id: member.id,
      }),
    })
      .then(async (response) => {
        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
              "Could not open this conversation."
          );
        }

        return data.conversation.id as string;
      })
      .then((id) => {
        // Remember it, so opening this DM again is
        // instant.
        setJson(`dmconvo:${member.id}`, id);

        if (!cancelled) {
          setConversationId(id);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not open this conversation."
          );

          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [member.id]);


  // ----------------------------------------
  // LOAD MESSAGES
  // ----------------------------------------

  const loadMessages = useCallback(
    async (id: string) => {
      const url = `/api/dms/${id}/messages`;

      const place = (loaded: DMMessage[]) => {
        const mine = loaded.find(
          (message) => message.sender === "you"
        );

        if (mine) {
          meRef.current = mine.user_id;
        }

        setMessages(loaded);

        // Everything on screen has been seen.
        onRead?.(id);
      };

      // Paint the messages we already have for this
      // conversation, so reopening a DM is instant
      // rather than a spinner; the fetch still refreshes.
      const known = peekJson<{ messages?: DMMessage[] }>(
        url
      );

      if (known?.messages) {
        place(known.messages);
        setLoading(false);
      }

      try {
        const data = (await cachedJson(url, {
          force: true,
        })) as {
          error?: string;
          messages?: DMMessage[];
        };

        if (data.error) {
          throw new Error(data.error);
        }

        place((data.messages ?? []) as DMMessage[]);
      } catch (cause) {
        if (!known) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load messages."
          );
        }
      } finally {
        setLoading(false);
      }
    },
    [onRead]
  );


  // ----------------------------------------
  // REALTIME
  // ----------------------------------------

  useEffect(() => {
    if (!conversationId) {
      return;
    }

    void loadMessages(conversationId);

    const supabase = createClient();

    const channel = supabase
      .channel(`dm:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "dm_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          // Realtime already carries the row.
          // Refetching the whole conversation to
          // learn one message got slower with
          // every message ever sent, and threw
          // away scroll position doing it.

          const row = payload.new as {
            id: string;
            content: string;
            user_id: string;
            created_at: string;
          };

          setMessages((previous) => {
            // The sender already added this
            // optimistically, and both people get
            // the same event.

            if (
              previous.some(
                (message) => message.id === row.id
              )
            ) {
              return previous;
            }

            return [
              ...previous,
              {
                ...row,
                sender:
                  row.user_id === meRef.current
                    ? "you"
                    : "teammate",
              },
            ];
          });

          onRead?.(conversationId);
        }
      )

      // Inserts were the only thing listened
      // for, so an edit or a deletion by the
      // other person stayed invisible until a
      // reload.

      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "dm_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            content: string;
            edited_at: string | null;
          };

          setMessages((previous) =>
            previous.map((message) =>
              message.id === row.id
                ? {
                    ...message,
                    content: row.content,
                    edited_at: row.edited_at,
                  }
                : message
            )
          );
        }
      )

      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "dm_messages",
        },
        (payload) => {
          // A delete carries only the key, and
          // no conversation to filter on, so
          // every DM open in this tab hears
          // every deletion. Removing an id that
          // is not here does nothing.

          const gone = payload.old as {
            id?: string;
          };

          if (!gone.id) {
            return;
          }

          setMessages((previous) =>
            previous.filter(
              (message) => message.id !== gone.id
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, loadMessages, onRead]);


  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages]);


  // ----------------------------------------
  // SEND
  // ----------------------------------------

  async function saveEdit(messageId: string) {
    const text = editDraft.trim();

    if (!text || !conversationId) {
      return;
    }

    // On screen first. The server is about to
    // agree, and if it does not, the reload in
    // the failure path is the correction.

    setMessages((previous) =>
      previous.map((message) =>
        message.id === messageId
          ? {
              ...message,
              content: text,
              edited_at: new Date().toISOString(),
            }
          : message
      )
    );

    setEditingId(null);

    const response = await fetch(
      `/api/dms/${conversationId}/messages`,
      {
        method: "PATCH",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          id: messageId,
          content: text,
        }),
      }
    );

    if (!response.ok) {
      const data = await response.json();

      setError(
        data.error || "Could not edit that."
      );

      void loadMessages(conversationId);
    }
  }


  async function remove(messageId: string) {
    if (!conversationId) {
      return;
    }

    setMessages((previous) =>
      previous.filter(
        (message) => message.id !== messageId
      )
    );

    const response = await fetch(
      `/api/dms/${conversationId}/messages?id=${messageId}`,
      { method: "DELETE" }
    );

    if (!response.ok) {
      const data = await response.json();

      setError(
        data.error || "Could not delete that."
      );

      void loadMessages(conversationId);
    }
  }


  async function attach(files: File[]) {
    if (!conversationId) {
      return;
    }

    for (const file of files) {
      const tempId = `pending-${crypto.randomUUID()}`;

      // On screen straight away, so a big file
      // does not look like nothing happened.

      setPending((previous) => [
        ...previous,
        {
          id: tempId,
          filename: file.name,
          mime: file.type,
          size_bytes: file.size,
          kind: "other",
        } as Attachment,
      ]);

      setUploadingIds((previous) => [
        ...previous,
        tempId,
      ]);

      try {
        const form = new FormData();

        form.set("file", file);
        form.set("conversationId", conversationId);

        const response = await fetch(
          "/api/attachments",
          { method: "POST", body: form }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ?? "Upload failed."
          );
        }

        setPending((previous) =>
          previous.map((item) =>
            item.id === tempId
              ? data.attachment
              : item
          )
        );
      } catch (cause) {
        setPending((previous) =>
          previous.filter(
            (item) => item.id !== tempId
          )
        );

        setError(
          cause instanceof Error
            ? cause.message
            : `Could not upload ${file.name}.`
        );
      } finally {
        setUploadingIds((previous) =>
          previous.filter((id) => id !== tempId)
        );
      }
    }
  }


  async function send() {
    const text = draft.trim();

    // A file on its own is a message.

    if (
      (!text && pending.length === 0) ||
      !conversationId
    ) {
      return;
    }

    const attachmentIds = pending.map(
      (item) => item.id
    );

    setDraft("");
    setPending([]);

    try {
      const response = await fetch(
        `/api/dms/${conversationId}/messages`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            content: text,
            attachment_ids: attachmentIds,
          }),
        }
      );

      if (!response.ok) {
        const data = await response.json();

        throw new Error(
          data.error || "Could not send."
        );
      }

      await loadMessages(conversationId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not send."
      );
    }
  }


  return (
    <section className="flex min-w-0 flex-1 flex-col">

      {/* HEADER */}

      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 sm:px-5">
        {onOpenMenu && <MenuButton onClick={onOpenMenu} />}

        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--bg-raised)] text-[10px] font-medium text-[var(--text-muted)]">
          {name.charAt(0).toUpperCase()}
        </span>

        <h1 className="min-w-0 truncate text-[13px] font-medium text-[var(--text)]">
          {name}
        </h1>

        <span className="hidden text-[12px] text-[var(--text-faint)] sm:inline">
          Direct message
        </span>
      </header>


      {/* MESSAGES */}

      <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-5 sm:py-6">
        <div className="mx-auto max-w-3xl space-y-3">
          {loading ? (
            <p className="text-[13px] text-[var(--text-faint)]">
              Opening conversation…
            </p>
          ) : error ? (
            <p className="rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-[13px] text-red-200">
              {error}
            </p>
          ) : messages.length === 0 ? (
            <p className="text-[13px] text-[var(--text-faint)]">
              This is the start of your
              conversation with {name}.
            </p>
          ) : (
            messages.map((message, index) => {
              const mine =
                message.sender === "you";

              // A line between days, so a
              // conversation has a shape rather
              // than being one long scroll.

              const previous = messages[index - 1];

              const newDay =
                !previous ||
                new Date(
                  previous.created_at
                ).toDateString() !==
                  new Date(
                    message.created_at
                  ).toDateString();

              return (
                <div key={message.id}>
                  {newDay && (
                    <div className="flex items-center gap-3 py-3">
                      <div className="h-px flex-1 bg-[var(--border)]" />

                      <span className="text-[11px] text-[var(--text-faint)]">
                        {dayOf(message.created_at)}
                      </span>

                      <div className="h-px flex-1 bg-[var(--border)]" />
                    </div>
                  )}

                <div
                  className={`group flex ${
                    mine
                      ? "justify-end"
                      : "justify-start"
                  }`}
                >
                  {editingId === message.id ? (
                    <div className="w-full max-w-[min(36rem,92%)] sm:max-w-[min(36rem,85%)]">
                      <textarea
                        autoFocus
                        rows={3}
                        value={editDraft}
                        onChange={(event) =>
                          setEditDraft(
                            event.target.value
                          )
                        }
                        onKeyDown={(event) => {
                          if (
                            event.key === "Escape"
                          ) {
                            setEditingId(null);
                          }

                          if (
                            event.key === "Enter" &&
                            !event.shiftKey
                          ) {
                            event.preventDefault();

                            void saveEdit(
                              message.id
                            );
                          }
                        }}
                        className="w-full resize-none rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-raised)] px-3.5 py-2 text-[13.5px] leading-[1.55] text-[var(--text)] outline-none focus:border-[var(--accent)]"
                      />

                      <div className="mt-1.5 flex items-center justify-end gap-2">
                        <span className="mr-auto text-[10.5px] text-[var(--text-faint)]">
                          Enter saves · Escape
                          cancels
                        </span>

                        <button
                          type="button"
                          onClick={() =>
                            setEditingId(null)
                          }
                          className="rounded px-2 py-1 text-[11px] text-[var(--text-muted)] transition hover:text-[var(--text)]"
                        >
                          Cancel
                        </button>

                        <button
                          type="button"
                          disabled={
                            !editDraft.trim()
                          }
                          onClick={() =>
                            void saveEdit(
                              message.id
                            )
                          }
                          className="rounded bg-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-[var(--bg)] transition hover:opacity-90 disabled:opacity-40"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                  <div
                    className={`flex max-w-[min(36rem,92%)] sm:max-w-[min(36rem,85%)] flex-col ${
                      mine
                        ? "items-end"
                        : "items-start"
                    }`}
                  >
                  <div
                    className={`rounded-2xl px-3.5 py-2 text-[13.5px] leading-[1.55] ${
                      mine
                        ? "rounded-tr-md bg-[var(--bg-raised)] text-[var(--text)]"
                        : "rounded-tl-md border border-[var(--border)] text-[var(--text)]"
                    }`}
                  >
                    {/* The same renderer the    */}
                    {/* channels use. A code     */}
                    {/* block pasted into a DM   */}
                    {/* used to arrive as a wall */}
                    {/* of grey text.            */}

                    {message.content && (
                      <Markdown
                        content={message.content}
                      />
                    )}

                    {(message.attachments?.length ??
                      0) > 0 && (
                      <div
                        className={
                          message.content
                            ? "mt-2"
                            : ""
                        }
                      >
                        <AttachmentList
                          attachments={
                            message.attachments ??
                            []
                          }
                        />
                      </div>
                    )}

                  </div>

                  <span className="mt-1 px-1 text-[10.5px] text-[var(--text-faint)]">
                    {timeOf(message.created_at)}

                    {message.edited_at && (
                      <span> · edited</span>
                    )}
                  </span>

                  {/* Your own only. There is no */}
                  {/* agent in a DM, so there is */}
                  {/* no second rule about whose */}
                  {/* words these are.           */}

                  {mine && (
                    <span className="mt-0.5 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 [@media(hover:none)]:opacity-100 focus-within:opacity-100">
                      <button
                        type="button"
                        onClick={() => {
                          setEditDraft(
                            message.content
                          );

                          setEditingId(message.id);
                        }}
                        className="rounded px-1.5 py-1 text-[10.5px] text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
                      >
                        Edit
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          void remove(message.id)
                        }
                        className="rounded px-1.5 py-1 text-[10.5px] text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-red-300"
                      >
                        Delete
                      </button>
                    </span>
                  )}
                  </div>
                  )}
                </div>
                </div>
              );
            })
          )}

          <div ref={bottomRef} />
        </div>
      </div>


      {/* COMPOSER */}

      <Composer
        value={draft}
        onChange={setDraft}
        onSend={send}
        onStop={() => {}}
        streaming={false}
        status=""
        disabled={!conversationId}
        placeholder={`Message ${name}`}
        attachments={pending}
        uploadingIds={uploadingIds}
        onAttach={attach}
        onRemoveAttachment={(id) =>
          setPending((previous) =>
            previous.filter(
              (item) => item.id !== id
            )
          )
        }
      />
    </section>
  );
}
