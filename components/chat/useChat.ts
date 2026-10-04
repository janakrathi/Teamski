"use client";

import {
  useCallback,
  useRef,
  useState,
} from "react";


// ==========================================
// TYPES
// ==========================================

export type Activity = {
  key: string;
  label: string;
  status:
    | "working"
    | "done"
    | "failed"
    | "blocked";
};

// A destructive tool the agent wants to run and
// is waiting on a human for.

export type ApprovalRequest = {
  tool: string;
  filename: string | null;
  label: string;
};

export type Usage = {
  promptTokens: number;
  responseTokens: number;
  ms: number;
  model: string;
};

import type { Attachment } from "./Attachments";


export type ChatMessage = {
  id?: string;
  localId: string;

  // Where this turn belongs, stamped when it is
  // sent. A reply can arrive long after you have
  // moved to another channel, and it belongs to
  // the conversation you asked in, not the one
  // you happen to be looking at.
  projectId?: string;
  channelId?: string | null;

  role: "user" | "assistant";
  sender: "you" | "teammate" | "agent";
  sender_name?: string | null;
  content: string;
  file?: string;
  activity?: Activity[];
  thinking?: string;
  usage?: Usage;
  attachmentIds?: string[];
  attachments?: Attachment[];
  approvals?: ApprovalRequest[];
  error?: string;
  streaming?: boolean;
  stopped?: boolean;
  created_at?: string;

  // Set once somebody changed what they wrote.
  // An edit that does not admit it is a small
  // dishonesty, and in a shared channel other
  // people have already read the first version.
  edited_at?: string | null;

  // The message this reply answers. `reply_to` is the
  // id (from the server); `replyToContent` is a snippet
  // of that message, shown above the reply so an
  // out-of-order thread is readable.
  reply_to?: string | null;
  replyToContent?: string;

  // Set when the chosen model could not be
  // reached - no key of yours, none shared by the
  // project - and the machine answered instead.
  fellBackTo?: string;
  fellBackReason?: "no-key" | "budget" | "plan" | "limit" | "limit-model";

  // The model that was asked for, when another
  // model on the same key answered instead.
  fellBackFrom?: string;

  // The model that wrote this reply, shown in place of
  // "Agent". From the stream while it is live, and
  // saved with the reply (0036).
  model?: string | null;
};

// Bumped when a default changes in a way that
// should reach people who already have settings
// saved. Without it a new default is invisible to
// everyone but a new browser.

export const SETTINGS_VERSION = 2;


export type ChatSettings = {
  version?: number;
  temperature: number;
  showThinking: boolean;
  useMemory: boolean;
  useTools: boolean;
  useWeb: boolean;
  instructions: string;
};

export const DEFAULT_SETTINGS: ChatSettings = {
  version: SETTINGS_VERSION,
  temperature: 0.7,
  showThinking: false,
  useMemory: true,
  useTools: true,
  useWeb: true,
  instructions: "",
};


// One conversation: a channel in a project, or
// a project with no channel. Both the hook and
// the view need to name the same thing, so the
// name is made in one place.

export function conversationKey(
  projectId: string | null | undefined,
  channelId: string | null | undefined
) {
  return `${projectId ?? "none"}:${
    channelId ?? "none"
  }`;
}


export function newLocalId() {
  return Math.random()
    .toString(36)
    .slice(2, 11);
}


// ==========================================
// CHAT STREAMING
// ==========================================
//
// Owns the network side of a conversation:
// sending a turn, reading the NDJSON event
// stream, and folding each event into the
// message being written.
//

export function useChat(options: {
  onPersist: (
    message: ChatMessage
  ) => Promise<void> | void;
}) {
  const [messages, setMessages] = useState<
    ChatMessage[]
  >([]);

  // A reply belongs to the conversation it was
  // asked in, so being busy does too. One flag
  // for the whole app meant a reply in #general
  // locked the composer in #design, in a DM, and
  // in every other project - which is not what
  // "the agent is busy" should mean when the
  // agent is per-channel.
  //
  // Keyed by conversation, holding the status
  // line for each. Empty means nothing is
  // streaming anywhere.

  const [streams, setStreams] = useState<
    Record<string, string>
  >({});

  const controllersRef = useRef(
    new Map<string, AbortController>()
  );

  const persistRef = useRef(options.onPersist);

  persistRef.current = options.onPersist;


  // ----------------------------------------
  // UPDATE THE MESSAGE BEING STREAMED
  // ----------------------------------------

  // Find the message by identity rather than by
  // position. "The last one" is only the reply
  // being written while you stay put - switch
  // channels mid-stream and the last one belongs
  // to somebody else's conversation, which is
  // exactly what used to get overwritten.
  //
  // Gone from the list means you have moved on.
  // The tokens are still collected, and the
  // finished reply is still saved to the channel
  // it was asked in; there is just nothing on
  // screen to update.

  const patchMessage = useCallback(
    (
      localId: string,

      update: (
        message: ChatMessage
      ) => ChatMessage
    ) => {
      setMessages((previous) => {
        const index = previous.findIndex(
          (message) =>
            message.localId === localId
        );

        if (index === -1) {
          return previous;
        }

        const next = [...previous];

        next[index] = update(next[index]);

        return next;
      });
    },
    []
  );


  // ----------------------------------------
  // STOP
  // ----------------------------------------

  // Stop is a button in one conversation, so it
  // stops that conversation's reply and leaves
  // the others alone.

  const stop = useCallback((key: string) => {
    controllersRef.current.get(key)?.abort();

    controllersRef.current.delete(key);
  }, []);


  // ----------------------------------------
  // SEND A TURN
  // ----------------------------------------

  const send = useCallback(
    async (options: {
      text: string;
      projectId: string;
      channelId: string | null;
      channelName?: string;
      projectName?: string;
      settings: ChatSettings;
      history: ChatMessage[];
      skipUserMessage?: boolean;
      approvals?: ApprovalRequest[];
      attachmentIds?: string[];
      attachments?: Attachment[];
    }) => {

      const {
        text,
        projectId,
        channelId,
        projectName,
        channelName,
        settings,
      } = options;

      const userMessage: ChatMessage = {
        localId: newLocalId(),
        role: "user",
        sender: "you",
        content: text,
        projectId,
        channelId,
        attachmentIds: options.attachmentIds,
        attachments: options.attachments,
      };

      const history = options.skipUserMessage
        ? options.history
        : [...options.history, userMessage];

      const key = conversationKey(
        projectId,
        channelId
      );

      // One reply at a time per conversation.
      // Two in the same channel would race for
      // the same history.

      if (controllersRef.current.has(key)) {
        return;
      }

      const say = (line: string) =>
        setStreams((previous) => ({
          ...previous,
          [key]: line,
        }));

      const agentMessage: ChatMessage = {
        localId: newLocalId(),
        role: "assistant",
        sender: "agent",
        content: "",
        projectId,
        channelId,
        activity: [],
        streaming: true,

        // What this reply answers, so it can be shown
        // right away even before the server saves the
        // link - it matters most while replies are
        // streaming back out of order.
        replyToContent: options.skipUserMessage
          ? undefined
          : text,
      };

      // Every update below is aimed at this one
      // message, wherever it has ended up in the
      // list - or nowhere, if you have moved to
      // another channel since.

      const patchLast = (
        update: (
          message: ChatMessage
        ) => ChatMessage
      ) =>
        patchMessage(
          agentMessage.localId,
          update
        );

      setMessages([...history, agentMessage]);

      say("Connecting to the model");

      if (!options.skipUserMessage) {
        await persistRef.current(userMessage);
      }

      const controller = new AbortController();

      controllersRef.current.set(key, controller);

      let answer = "";
      let file: string | undefined;
      let stopped = false;

      try {
        const response = await fetch(
          "/api/chat",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            signal: controller.signal,

            body: JSON.stringify({
              projectId,
              channelId,
              projectName,
              channelName,

              messages: history.map(
                (message) => ({
                  role: message.role,
                  content: message.content,
                })
              ),

              temperature:
                settings.temperature,

              think: settings.showThinking,
              useMemory: settings.useMemory,
              useTools: settings.useTools,
              useWeb: settings.useWeb,
              instructions:
                settings.instructions,

              approvals: (
                options.approvals ?? []
              ).map((grant) => ({
                tool: grant.tool,
                filename: grant.filename,
              })),

              attachmentIds:
                options.attachmentIds ?? [],
            }),
          }
        );

        if (!response.ok || !response.body) {
          const raw = await response
            .text()
            .catch(() => "");

          // Errors from the server are JSON; show
          // the sentence, not the braces.

          let said = raw;

          try {
            said =
              (JSON.parse(raw) as { error?: string })
                .error ?? raw;
          } catch {
            // Plain text already.
          }

          throw new Error(
            said || "The agent did not respond."
          );
        }

        const reader =
          response.body.getReader();

        const decoder = new TextDecoder();

        let buffer = "";

        while (true) {
          const { value, done } =
            await reader.read();

          if (done) {
            break;
          }

          buffer += decoder.decode(value, {
            stream: true,
          });

          const lines = buffer.split("\n");

          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) {
              continue;
            }

            let event: Record<string, unknown>;

            try {
              event = JSON.parse(line);
            } catch {
              continue;
            }

            // ============================
            // META
            // ============================

            if (event.type === "meta") {
              // The model asked for could not be
              // paid for, so the machine answered
              // instead. Said on the message
              // rather than in a status line that
              // disappears, because it explains
              // why the answer is different from
              // the last one.

              if (event.fellBack) {
                patchLast((message) => ({
                  ...message,
                  fellBackTo: String(
                    event.model ?? "the local model"
                  ),

                  fellBackReason:
                    event.reason as
                      | "no-key"
                      | "budget"
                      | "plan"
                      | "limit"
                      | "limit-model"
                      | undefined,

                  fellBackFrom: event.from
                    ? String(event.from)
                    : undefined,
                }));
              }

              const memory = event.memory as
                | { facts?: number }
                | undefined;

              say(
                memory?.facts
                  ? `Recalling ${memory.facts} remembered ${
                      memory.facts === 1
                        ? "detail"
                        : "details"
                    }`
                  : "Thinking"
              );
            }

            // ============================
            // STATUS
            // ============================
            //
            // The server's own word on the
            // wait - the AI is busy with
            // somebody else's reply first.

            else if (event.type === "status") {
              say(String(event.text ?? "Waiting"));
            }

            // ============================
            // TOKEN
            // ============================
            else if (event.type === "token") {
              answer += String(event.text ?? "");

              say("Writing");

              patchLast((message) => ({
                ...message,
                content: answer,
              }));
            }

            // ============================
            // RESET
            // ============================
            //
            // The model spoke before calling a
            // tool. That text was not the
            // answer, so drop it.

            else if (event.type === "reset") {
              answer = "";

              patchLast((message) => ({
                ...message,
                content: "",
              }));
            }

            // ============================
            // THINKING
            // ============================
            else if (
              event.type === "thinking"
            ) {
              patchLast((message) => ({
                ...message,

                thinking:
                  (message.thinking ?? "") +
                  String(event.text ?? ""),
              }));
            }

            // ============================
            // ACTIVITY
            // ============================
            else if (
              event.type === "activity"
            ) {
              const key = String(
                event.text ?? ""
              );

              const label = String(
                event.label ?? event.text ?? ""
              );

              const eventStatus =
                event.status === "done"
                  ? "done"
                  : event.status === "failed"
                    ? "failed"
                    : event.status === "blocked"
                      ? "blocked"
                      : "working";

              say(label);

              patchLast((message) => {
                const activity = [
                  ...(message.activity ?? []),
                ];

                const existing =
                  activity.findIndex(
                    (item) => item.key === key
                  );

                if (existing >= 0) {
                  activity[existing] = {
                    key,
                    label,
                    status: eventStatus,
                  };
                } else {
                  activity.push({
                    key,
                    label,
                    status: eventStatus,
                  });
                }

                return {
                  ...message,
                  activity,
                };
              });
            }

            // ============================
            // COMPLETE
            // ============================
            else if (
              event.type === "model"
            ) {
              const answering = String(event.model ?? "");

              patchLast((message) => ({
                ...message,
                model: answering || message.model,
              }));
            } else if (
              event.type === "complete"
            ) {
              answer =
                String(event.message ?? "") ||
                answer;

              file = event.file as
                | string
                | undefined;

              stopped =
                event.stopped === true;

              patchLast((message) => ({
                ...message,
                content: answer,
                file,
                stopped,
                streaming: false,
                usage: event.usage as Usage,
              }));

              // A reply carrying a generated image is
              // the cue to offer the person their own
              // image key.
              if (
                typeof window !== "undefined" &&
                answer.includes("/api/images/")
              ) {
                window.dispatchEvent(
                  new Event("teamski:image-made")
                );
              }
            }

            // ============================
            // APPROVAL REQUEST
            // ============================
            else if (
              event.type === "approval"
            ) {
              patchLast((message) => ({
                ...message,

                approvals: [
                  ...(message.approvals ?? []),
                  {
                    tool: String(event.tool),
                    filename:
                      (event.filename as
                        | string
                        | null) ?? null,
                    label: String(event.label),
                  },
                ],
              }));
            }

            // ============================
            // ERROR
            // ============================
            else if (event.type === "error") {
              patchLast((message) => ({
                ...message,
                streaming: false,
                error: String(
                  event.message ??
                    "The agent failed."
                ),
              }));
            }
          }
        }

        // The agent's reply is saved by the
        // server now (see app/api/chat), so the
        // browser does not save it. The database
        // refuses an agent message from a browser,
        // which is what stops a forged one.
      } catch (error) {
        const aborted =
          error instanceof Error &&
          error.name === "AbortError";

        patchLast((message) => ({
          ...message,
          streaming: false,
          stopped: aborted,

          error: aborted
            ? undefined
            : error instanceof Error
              ? error.message
              : "Something went wrong.",
        }));

        // A stopped reply the model got partway
        // through is saved by the server too, when
        // it ends the stream.
      } finally {
        controllersRef.current.delete(key);

        setStreams((previous) => {
          const next = { ...previous };

          delete next[key];

          return next;
        });
      }
    },
    [patchMessage]
  );


  return {
    messages,
    setMessages,

    // Keyed by conversation. A view asks about
    // its own key rather than about the app as a
    // whole.
    streams,

    send,
    stop,
  };
}
