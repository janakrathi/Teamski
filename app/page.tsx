"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import dynamic from "next/dynamic";

import { createClient } from "@/lib/supabase/client";

import { primeProfile } from "@/lib/account/profile";

import {
  cachedJson,
  invalidateJson,
  peekJson,
} from "@/lib/net/cache";

import Sidebar from "@/components/sidebar/Sidebar";

import {
  CollapsedRail,
  ResizeHandle,
  useSidebarLayout,
} from "@/components/sidebar/SidebarResize";

import { PromptDialog } from "@/components/ui/Dialog";

// These panels are heavy and only appear behind a
// click (settings, search, a DM, the new-channel
// dialog). Loading them on demand keeps the initial
// bundle small, so the app is interactive sooner on
// both phone and desktop. They are client-only, so
// ssr: false, and each is mounted only when open, so
// its code downloads the first time it is needed.

const NewChannelDialog = dynamic(
  () => import("@/components/chat/NewChannelDialog"),
  { ssr: false }
);

const ChannelAccessDialog = dynamic(
  () => import("@/components/chat/ChannelAccessDialog"),
  { ssr: false }
);

import FirstRun from "@/components/onboarding/FirstRun";

import ConnectGroq from "@/components/onboarding/ConnectGroq";

import ConnectCloudflare from "@/components/onboarding/ConnectCloudflare";

import { templateById } from "@/lib/agents/templates";
import Composer from "@/components/chat/Composer";
import MessageRow from "@/components/chat/MessageRow";
import AgentDock from "@/components/agents/AgentDock";
import NotificationBell from "@/components/notifications/NotificationBell";

const DMView = dynamic(
  () => import("@/components/chat/DMView"),
  { ssr: false }
);

const SettingsPanel = dynamic(
  () => import("@/components/chat/SettingsPanel"),
  { ssr: false }
);

const SearchPalette = dynamic(
  () => import("@/components/search/SearchPalette"),
  { ssr: false }
);

import {
  findMentioned,
  mentionsAgent,
} from "@/lib/mentions";

import type { Attachment } from "@/components/chat/Attachments";

import {
  DEFAULT_SETTINGS,
  SETTINGS_VERSION,
  conversationKey,
  newLocalId,
  useChat,
  type ApprovalRequest,
  type ChatMessage,
  type ChatSettings,
} from "@/components/chat/useChat";

import {
  Hash,
  Search as SearchIcon,
} from "@/components/ui/Icons";

import MenuButton from "@/components/ui/MenuButton";

import { usePresence } from "@/lib/ui/usePresence";

import type {
  Channel,
  Member,
  Project,
} from "@/components/types";


const SETTINGS_KEY = "agentSettings";
const PROJECT_KEY = "currentProjectId";
const CHANNEL_KEY = "currentChannelId";


// ==========================================
// SUGGESTIONS
// ==========================================

// Read once when the component first mounts.
// Doing this in an effect meant every visit
// rendered the defaults and then immediately
// re-rendered with the saved values.

function readSettings(): ChatSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS;
  }

  try {
    const saved =
      window.localStorage.getItem(SETTINGS_KEY);

    if (!saved) {
      return DEFAULT_SETTINGS;
    }

    const stored = JSON.parse(
      saved
    ) as ChatSettings;

    // Settings saved before a default changed
    // would otherwise pin the old value forever,
    // so take the new defaults for this version
    // and keep what the person actually chose.

    if (
      (stored.version ?? 1) < SETTINGS_VERSION
    ) {
      return {
        ...DEFAULT_SETTINGS,
        instructions:
          stored.instructions ??
          DEFAULT_SETTINGS.instructions,
        temperature:
          stored.temperature ??
          DEFAULT_SETTINGS.temperature,
      };
    }

    return { ...DEFAULT_SETTINGS, ...stored };
  } catch {
    // A corrupt value just means defaults.
    return DEFAULT_SETTINGS;
  }
}


const SUGGESTIONS = [
  "List the files in this project",
  "Create notes.md with today's plan",
  "Summarise what we decided so far",
];


export default function Home() {

  // ----------------------------------------
  // WORKSPACE STATE
  // ----------------------------------------

  const [projects, setProjects] = useState<
    Project[]
  >([]);

  const [currentProject, setCurrentProject] =
    useState<Project | null>(null);

  const [channels, setChannels] = useState<
    Channel[]
  >([]);

  const [currentChannel, setCurrentChannel] =
    useState<Channel | null>(null);

  const [channelsNeedMigration, setChannelsNeedMigration] =
    useState(false);

  const [members, setMembers] = useState<Member[]>(
    []
  );

  // When set, the main pane shows a DM instead
  // of the agent channel.

  const [activeMember, setActiveMember] =
    useState<Member | null>(null);

  // How much has happened in the places you are
  // not looking. Keyed by channel id and, for
  // direct messages, by the other person's id.

  // Naming a project and naming a channel are
  // the same dialog asked twice, so one piece of
  // state says which question is on screen.

  const [asking, setAsking] = useState<
    "project" | "channel" | null
  >(null);

  // The signed-in person's role in the current project
  // (from the channel list). A viewer reads; the
  // composer and channel menu are not offered.
  const [myRole, setMyRole] = useState<string | null>(
    null
  );

  // The channel whose "who can see it" dialog is open.
  const [accessFor, setAccessFor] =
    useState<Channel | null>(null);

  // Something went wrong that is worth a
  // sentence but not a dialog. An alert() froze
  // the page to say a file did not upload.

  const [notice, setNotice] = useState("");


  const [unreadChannels, setUnreadChannels] =
    useState<Record<string, number>>({});

  const [unreadDMs, setUnreadDMs] = useState<
    Record<string, number>
  >({});

  const [draft, setDraft] = useState("");

  // Files attached to the message being written.
  // They upload as soon as they are chosen, so
  // sending is instant and the text is already
  // extracted by then.

  const [pending, setPending] = useState<
    Attachment[]
  >([]);

  const [uploadingIds, setUploadingIds] =
    useState<string[]>([]);

  const [loadingMessages, setLoadingMessages] =
    useState(false);

  const [settingsOpen, setSettingsOpen] =
    useState(false);

  // Set when the settings were opened to connect
  // a model, so they open on the AI tab.
  const [settingsTab, setSettingsTab] = useState<"ai" | undefined>();

  // Whether this person has a Gemini key yet. The
  // empty channel offers one until they do - it is
  // free, and far quicker than the built-in model.
  const [hasGemini, setHasGemini] = useState(true);

  // Warm the profile cache once, off the critical path,
  // so the first time Settings opens the account is
  // already loaded instead of showing "Loading…".
  useEffect(() => {
    const idle =
      typeof window !== "undefined" &&
      "requestIdleCallback" in window
        ? (
            window as unknown as {
              requestIdleCallback: (cb: () => void) => number;
            }
          ).requestIdleCallback
        : (cb: () => void) =>
            window.setTimeout(cb, 1200);

    idle(() => primeProfile());
  }, []);


  useEffect(() => {
    if (settingsOpen) {
      return;
    }

    let cancelled = false;

    fetch("/api/models/keys", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) {
          setHasGemini(
            (data.connected ?? []).some(
              (entry: { service: string }) => entry.service === "google"
            )
          );
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [settingsOpen]);

  // Somebody with no projects at all has just
  // signed up and was not invited to anything.
  // They get the setup steps instead of an empty
  // app - but only once the list has actually
  // loaded, or everyone would see it flash.

  const [projectsLoaded, setProjectsLoaded] =
    useState(false);

  const [setupDone, setSetupDone] = useState(false);

  // Which template the current channel's agent
  // started from, for the first messages an
  // empty channel offers.

  const [channelTemplate, setChannelTemplate] =
    useState<{
      channelId: string;
      templateId: string | null;
    } | null>(null);

  const channelIdForTemplate =
    currentChannel?.id ?? null;

  useEffect(() => {
    if (!channelIdForTemplate) {
      return;
    }

    let cancelled = false;

    fetch(
      `/api/agents/channel?channelId=${channelIdForTemplate}`
    )
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) {
          setChannelTemplate({
            channelId: channelIdForTemplate,
            templateId:
              data.agent?.template_id ?? null,
          });
        }
      })
      .catch(() => {
        // The general suggestions will do.
      });

    return () => {
      cancelled = true;
    };
  }, [channelIdForTemplate]);

  // Coming back from connecting an account or an
  // app lands on "/?connected=...". Open settings
  // where the person left, rather than dropping
  // them on an empty chat wondering if it worked.

  useEffect(() => {
    void Promise.resolve().then(() => {
      if (
        new URLSearchParams(
          window.location.search
        ).has("connected")
      ) {
        setSettingsOpen(true);
      }
    });
  }, []);

  // Width and hidden, dragged or Ctrl+B.
  const sidebar = useSidebarLayout();

  // On a phone the sidebar is a drawer over the
  // conversation instead, opened from the menu
  // button and closed by choosing anything in it.
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Kept on screen for its slide out.
  const drawer = usePresence(drawerOpen, 350);

  useEffect(() => {
    if (!drawerOpen) {
      return;
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDrawerOpen(false);
      }
    }

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const [searchOpen, setSearchOpen] =
    useState(false);

  const [settings, setSettings] =
    useState<ChatSettings>(readSettings);

  const [health, setHealth] = useState<{
    online: boolean;
    model: string;
  }>({ online: true, model: "" });

  const bottomRef =
    useRef<HTMLDivElement>(null);

  const scrollRef =
    useRef<HTMLDivElement>(null);

  // Whether the view should stay pinned to the
  // newest message. True until the reader scrolls
  // up, and reset whenever a conversation opens.

  const stickRef = useRef(true);

  // Cleared once a conversation has been pinned
  // for the first time, which is the jump that
  // should not animate.

  const landedRef = useRef(false);


  // ----------------------------------------
  // PERSIST A MESSAGE
  // ----------------------------------------

  const persistMessage = useCallback(
    async (message: ChatMessage) => {
      // A message knows where it belongs, having
      // been stamped when it was sent. Falling
      // back to wherever you are standing now is
      // only for messages posted straight from
      // this view, which are saved immediately.

      const projectId =
        message.projectId ?? currentProject?.id;

      const channelId =
        message.channelId !== undefined
          ? message.channelId
          : (currentChannel?.id ?? null);

      if (!projectId) {
        return;
      }

      try {
        await fetch(
          `/api/projects/${projectId}/messages`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              role: message.role,
              content: message.content,
              file: message.file ?? null,
              channel_id: channelId,

              // Hands the uploaded files to the
              // message so they stop being
              // orphaned once it is sent.
              attachment_ids:
                message.attachmentIds ?? [],
            }),
          }
        );
      } catch (error) {
        console.error(
          "Failed to save message:",
          error
        );
      }
    },
    [currentProject, currentChannel]
  );

  const {
    messages,
    setMessages,
    streams,
    send,
    stop,
  } = useChat({ onPersist: persistMessage });


  // A reply is only this view's business if it
  // was asked for in this view. A reply running
  // in another channel is somebody else's, and
  // this composer should not be sitting there
  // disabled on account of it.

  const here = conversationKey(
    currentProject?.id,
    currentChannel?.id
  );

  const statusHere = streams[here] ?? "";

  const streamingHere = here in streams;

  // What the last answer cost, for the composer.
  // promptTokens is the context the model was
  // actually handed, which is the honest measure
  // of how full the window is - an estimate from
  // the message list would only be a guess at the
  // same number.

  const lastUsage = [...messages]
    .reverse()
    .find((message) => message.usage)?.usage;


  // Read inside loadMessages, which the realtime
  // subscription depends on - a ref keeps that
  // subscription from tearing down and rebuilding
  // every time a reply starts or finishes.

  const hereRef = useRef(false);

  useEffect(() => {
    hereRef.current = streamingHere;
  }, [streamingHere]);


  // ----------------------------------------
  // SETTINGS
  // ----------------------------------------

  useEffect(() => {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify(settings)
      );
    } catch {
      // Storage can be unavailable.
    }
  }, [settings]);


  // ----------------------------------------
  // SEARCH SHORTCUT
  // ----------------------------------------

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();

        setSearchOpen((wasOpen) => !wasOpen);
      }
    }

    window.addEventListener("keydown", onKey);

    return () =>
      window.removeEventListener("keydown", onKey);
  }, []);


  // ----------------------------------------
  // MODEL HEALTH
  // ----------------------------------------

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const response = await fetch(
          "/api/health",
          { cache: "no-store" }
        );

        const data = await response.json();

        if (!cancelled) {
          setHealth({
            online: Boolean(data.online),
            model: data.model ?? "",
          });
        }
      } catch {
        if (!cancelled) {
          setHealth((previous) => ({
            ...previous,
            online: false,
          }));
        }
      }
    }

    check();

    const timer = setInterval(check, 30_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);


  // ----------------------------------------
  // LOAD PROJECTS
  // ----------------------------------------

  useEffect(() => {
    async function loadProjects() {
      try {
        const response = await fetch(
          "/api/projects"
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error);
        }

        const loaded: Project[] =
          data.projects ?? [];

        setProjects(loaded);

        setProjectsLoaded(true);

        const savedId =
          localStorage.getItem(PROJECT_KEY);

        const restored = loaded.find(
          (project) => project.id === savedId
        );

        setCurrentProject(
          restored ?? loaded[0] ?? null
        );
      } catch (error) {
        console.error(
          "Failed to load projects:",
          error
        );
      }
    }

    loadProjects();
  }, []);


  // ----------------------------------------
  // LOAD CHANNELS AND MEMBERS
  // ----------------------------------------

  useEffect(() => {
    let cancelled = false;

    // Clearing runs inside the async body rather
    // than straight in the effect, so switching
    // projects does not force a second render
    // pass before the fetch even starts.

    async function reset() {
      if (cancelled) {
        return;
      }

      setChannels([]);
      setCurrentChannel(null);
      setMembers([]);
    }

    if (!currentProject) {
      void reset();

      return () => {
        cancelled = true;
      };
    }

    localStorage.setItem(
      PROJECT_KEY,
      currentProject.id
    );

    async function loadChannels(
      projectId: string
    ) {
      const url = `/api/projects/${projectId}/channels`;

      // Put the channels we already have for this
      // project on screen at once, so switching back to
      // it does not blank the sidebar; the fetch below
      // still refreshes them.
      const place = (channels: Channel[]) => {
        if (cancelled) {
          return;
        }

        setChannelsNeedMigration(false);
        setChannels(channels);

        // Keep the channel the person is on if it is
        // still in the list - the cached paint and the
        // refresh both run this, and the refresh must
        // not snap them off a channel they just picked.
        setCurrentChannel((current) => {
          if (
            current &&
            channels.some(
              (channel) => channel.id === current.id
            )
          ) {
            return current;
          }

          const savedId =
            localStorage.getItem(CHANNEL_KEY);

          const restored = channels.find(
            (channel) => channel.id === savedId
          );

          return restored ?? channels[0] ?? null;
        });
      };

      const known = peekJson<{
        channels?: Channel[];
        role?: string | null;
      }>(url);

      if (known?.channels) {
        place(known.channels);
        setMyRole(known.role ?? null);
      }

      try {
        const data = (await cachedJson(url, {
          force: true,
        })) as {
          error?: string;
          needsMigration?: boolean;
          channels?: Channel[];
          role?: string | null;
        };

        if (cancelled) {
          return;
        }

        setMyRole(data.role ?? null);

        if (data.error) {
          setChannelsNeedMigration(
            Boolean(data.needsMigration)
          );

          if (!known) {
            setChannels([]);
            setCurrentChannel(null);
          }

          return;
        }

        place(data.channels ?? []);
      } catch (error) {
        console.error(
          "Failed to load channels:",
          error
        );
      }
    }

    async function loadMembers(
      projectId: string
    ) {
      const url = `/api/projects/${projectId}/members`;

      // Instant from cache when we have it, then refresh.
      const known = peekJson<{
        members?: Member[];
      }>(url);

      if (known?.members && !cancelled) {
        setMembers(known.members);
      }

      try {
        const data = (await cachedJson(url, {
          force: true,
        })) as { members?: Member[] };

        if (!cancelled) {
          setMembers(data.members ?? []);
        }
      } catch (error) {
        console.error(
          "Failed to load members:",
          error
        );
      }
    }

    loadChannels(currentProject.id);
    loadMembers(currentProject.id);

    return () => {
      cancelled = true;
    };
  }, [currentProject]);


  // ----------------------------------------
  // LOAD MESSAGES
  // ----------------------------------------

  const loadMessages = useCallback(
    async (showSpinner: boolean) => {
      if (!currentProject) {
        return;
      }

      const query = currentChannel
        ? `?channelId=${currentChannel.id}`
        : "";

      const url = `/api/projects/${currentProject.id}/messages${query}`;

      type RawMessage = {
        id: string;
        role: "user" | "assistant";
        content: string;
        sender: "you" | "teammate" | "agent";
        file?: string;
        created_at: string;
        edited_at?: string | null;
        reply_to?: string | null;
        model?: string | null;
      };

      // Give the server's messages a local id and put
      // them on screen, unless a reply is still
      // streaming into this same conversation - never
      // clobber that. (A reply streaming into a
      // different channel is not a reason to keep its
      // messages under this one's name.)
      const apply = (raw: RawMessage[]) => {
        // Resolve each reply's "answering" snippet from
        // the message it points at, so a reply that
        // landed out of order shows what it answers.
        const byId = new Map(
          raw.map((message) => [
            message.id,
            message.content,
          ])
        );

        setMessages((previous) => {
          if (
            hereRef.current &&
            previous.some(
              (message) => message.streaming
            )
          ) {
            return previous;
          }

          // A message already on screen keeps its
          // localId - the row's key - so a reload
          // doesn't remount every row (a file preview
          // reloading, the list flashing). A reply that
          // just streamed in has no server id yet, so it
          // is matched by what it says; it also keeps
          // what only the stream knew (activity, usage).
          const byServerId = new Map(
            previous
              .filter((message) => message.id)
              .map((message) => [message.id, message])
          );

          const unsaved = previous.filter(
            (message) =>
              !message.id &&
              message.projectId === currentProject.id &&
              (message.channelId ?? null) ===
                (currentChannel?.id ?? null)
          );

          return raw.map((message) => {
            let match = byServerId.get(message.id);

            if (!match) {
              const at = unsaved.findIndex(
                (local) =>
                  local.role === message.role &&
                  local.content === message.content
              );

              if (at !== -1) {
                match = unsaved.splice(at, 1)[0];
              }
            }

            return {
              ...(match ?? {}),
              ...message,
              localId: match?.localId ?? newLocalId(),
              streaming: false,
              replyToContent: message.reply_to
                ? byId.get(message.reply_to)
                : match?.replyToContent,
            };
          });
        });
      };

      // What we already have for this conversation
      // paints instantly, so switching channels or DMs
      // is not a spinner every time. The fetch below
      // still runs, to catch anything new.
      //
      // Only when opening a conversation, though. On a
      // refresh (a new message arrived) the cached copy
      // is older than what is on screen - painting it
      // made a reply that had just finished vanish
      // until the fetch came back.
      const known = peekJson<{ messages?: RawMessage[] }>(
        url
      );

      if (showSpinner && known?.messages) {
        apply(known.messages);
      }

      try {
        if (showSpinner && !known) {
          setLoadingMessages(true);
        }

        const data = (await cachedJson(url, {
          force: true,
        })) as {
          error?: string;
          details?: string;
          messages?: RawMessage[];
        };

        if (data.error) {
          throw new Error(
            [data.error, data.details]
              .filter(Boolean)
              .join(" — ")
          );
        }

        apply(data.messages ?? []);
      } catch (error) {
        console.error(
          "Failed to load messages:",
          error
        );
      } finally {
        if (showSpinner && !known) {
          setLoadingMessages(false);
        }
      }
    },
    [currentProject, currentChannel, setMessages]
  );


  // ----------------------------------------
  // UNREAD
  // ----------------------------------------
  //
  // Realtime tells us the moment something
  // lands, but only while the tab is connected.
  // The poll is what makes the counts right
  // again after a laptop lid, a lost socket or a
  // reload.
  //

  const refreshUnread = useCallback(async () => {
    if (!currentProject) {
      setUnreadChannels({});
      setUnreadDMs({});

      return;
    }

    try {
      const response = await fetch(
        `/api/unread?projectId=${currentProject.id}`,
        { cache: "no-store" }
      );

      if (!response.ok) {
        return;
      }

      const data = await response.json();

      setUnreadChannels(data.channels ?? {});
      setUnreadDMs(data.dms ?? {});
    } catch {
      // A failed poll is not worth telling
      // anyone about. The next one will do.
    }
  }, [currentProject]);


  const markRead = useCallback(
    async (
      target:
        | { channelId: string }
        | { conversationId: string }
    ) => {
      try {
        await fetch("/api/unread", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify(target),
        });
      } catch {
        // Same: the next open will mark it.
      }

      await refreshUnread();
    },
    [refreshUnread]
  );


  // Stable, so opening a DM does not tear down
  // and rebuild its realtime subscription on
  // every render of this page.

  const markDMRead = useCallback(
    (conversationId: string) => {
      void markRead({ conversationId });
    },
    [markRead]
  );


  useEffect(() => {
    // Off the effect body, so the first count
    // does not land as a second render pass on
    // every project change.

    void Promise.resolve().then(refreshUnread);

    const timer = setInterval(refreshUnread, 20000);

    return () => clearInterval(timer);
  }, [refreshUnread]);


  // Whatever is on screen counts as read - both
  // when it opens and while you sit in it and
  // something new arrives.

  useEffect(() => {
    if (activeMember || !currentChannel) {
      return;
    }

    const channelId = currentChannel.id;

    void Promise.resolve().then(() =>
      markRead({ channelId })
    );
  }, [
    activeMember,
    currentChannel,
    messages.length,
    markRead,
  ]);


  // ----------------------------------------
  // REALTIME
  // ----------------------------------------

  useEffect(() => {
    if (!currentProject) {
      return;
    }

    if (currentChannel) {
      localStorage.setItem(
        CHANNEL_KEY,
        currentChannel.id
      );
    }

    // A newly opened conversation starts pinned
    // to its newest message.

    stickRef.current = true;
    landedRef.current = false;

    loadMessages(true);

    const supabase = createClient();

    const channel = supabase
      .channel(
        `messages:${currentProject.id}:${
          currentChannel?.id ?? "all"
        }`
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `project_id=eq.${currentProject.id}`,
        },
        () => {
          loadMessages(false);

          void refreshUnread();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [
    currentProject,
    currentChannel,
    loadMessages,
    refreshUnread,
  ]);


  // ----------------------------------------
  // AUTO SCROLL
  // ----------------------------------------
  //
  // Only follow the stream when the reader is
  // already near the bottom, so scrolling back
  // to re-read something is not fought.
  //

  useEffect(() => {
    const container = scrollRef.current;

    if (!container || messages.length === 0) {
      return;
    }

    if (!stickRef.current) {
      return;
    }

    // Content keeps arriving after the first
    // paint - markdown, fonts, an image - and each
    // one makes the container taller. Scrolling
    // once is not enough, so pin again on the next
    // two frames.

    function pin() {
      const element = scrollRef.current;

      if (!element || !stickRef.current) {
        return;
      }

      element.scrollTop = element.scrollHeight;
    }

    if (!landedRef.current) {
      landedRef.current = true;

      pin();
    } else {
      bottomRef.current?.scrollIntoView({
        behavior: "smooth",
      });
    }

    const first = requestAnimationFrame(() => {
      pin();

      requestAnimationFrame(pin);
    });

    return () => cancelAnimationFrame(first);
  }, [messages]);


  // Following stops the moment the reader scrolls
  // away from the bottom, and resumes when they
  // come back to it.

  function onScroll() {
    const container = scrollRef.current;

    if (!container) {
      return;
    }

    const distance =
      container.scrollHeight -
      container.scrollTop -
      container.clientHeight;

    stickRef.current = distance < 120;
  }


  // ----------------------------------------
  // ATTACH FILES
  // ----------------------------------------
  //
  // Files upload the moment they are chosen, so
  // sending is instant and the text has already
  // been extracted by then.
  //

  async function attach(files: File[]) {
    if (!currentProject) {
      return;
    }

    for (const file of files) {
      // Show it under a temporary id right away,
      // so a slow upload looks like progress
      // rather than nothing happening.

      const tempId = `pending-${newLocalId()}`;

      setPending((previous) => [
        ...previous,
        {
          id: tempId,
          filename: file.name,
          mime: file.type,
          size_bytes: file.size,
          kind: "other",
          truncated: false,
          note: null,
        },
      ]);

      setUploadingIds((previous) => [
        ...previous,
        tempId,
      ]);

      try {
        const form = new FormData();

        form.set("file", file);
        form.set("projectId", currentProject.id);

        if (currentChannel) {
          form.set("channelId", currentChannel.id);
        }

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
      } catch (error) {
        setPending((previous) =>
          previous.filter(
            (item) => item.id !== tempId
          )
        );

        setNotice(
          error instanceof Error
            ? error.message
            : `Could not upload ${file.name}.`
        );
      } finally {
        setUploadingIds((previous) =>
          previous.filter((id) => id !== tempId)
        );
      }
    }
  }


  // The dialog keeps whatever went wrong on
  // screen next to the field, so throwing from
  // here is how it gets there.

  async function createProject(name: string) {
    const response = await fetch(
      "/api/projects",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({ name }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error ||
          "Could not create the project."
      );
    }

    setProjects((previous) => [
      data.project,
      ...previous,
    ]);

    setCurrentProject(data.project);
    setActiveMember(null);
  }

  async function createChannel(
    name: string,
    templateId: string | null = null
  ) {
    if (!currentProject) {
      return;
    }

    const response = await fetch(
      `/api/projects/${currentProject.id}/channels`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({ name, templateId }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error ||
          "Could not create the channel."
      );
    }

    setChannelTemplate({
      channelId: data.channel.id,
      templateId,
    });

    setChannels((previous) => [
      ...previous,
      data.channel,
    ]);

    // The cached channel list for this project is now
    // a channel short; drop it so a later visit reloads.
    invalidateJson(
      `/api/projects/${currentProject.id}/channels`
    );

    setCurrentChannel(data.channel);
    setActiveMember(null);
  }


  async function renameChannel(
    channel: Channel,
    rawName: string
  ) {
    const name = rawName.trim();

    if (!currentProject || !name) {
      return;
    }

    const response = await fetch(
      `/api/projects/${currentProject.id}/channels`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channelId: channel.id,
          name,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      setNotice(
        data.error || "Could not rename that channel."
      );

      return;
    }

    setChannels((previous) =>
      previous.map((item) =>
        item.id === channel.id ? data.channel : item
      )
    );

    setCurrentChannel((current) =>
      current?.id === channel.id
        ? data.channel
        : current
    );

    invalidateJson(
      `/api/projects/${currentProject.id}/channels`
    );
  }


  async function deleteChannel(channel: Channel) {
    if (!currentProject) {
      return;
    }

    const response = await fetch(
      `/api/projects/${currentProject.id}/channels?channelId=${channel.id}`,
      { method: "DELETE" }
    );

    if (!response.ok) {
      const data = await response.json();

      setNotice(
        data.error || "Could not delete that channel."
      );

      return;
    }

    const remaining = channels.filter(
      (item) => item.id !== channel.id
    );

    setChannels(remaining);

    // If the open channel was the one deleted, move to
    // another so the view is not left on nothing.
    setCurrentChannel((current) =>
      current?.id === channel.id
        ? (remaining[0] ?? null)
        : current
    );

    invalidateJson(
      `/api/projects/${currentProject.id}/channels`
    );
  }


  async function renameProject(
    project: Project,
    rawName: string
  ) {
    const name = rawName.trim();

    if (!name) {
      return;
    }

    const response = await fetch("/api/projects", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: project.id, name }),
    });

    const data = await response.json();

    if (!response.ok) {
      setNotice(
        data.error || "Could not rename that project."
      );

      return;
    }

    setProjects((previous) =>
      previous.map((item) =>
        item.id === project.id
          ? { ...item, name }
          : item
      )
    );

    setCurrentProject((current) =>
      current?.id === project.id
        ? { ...current, name }
        : current
    );
  }

  // Editing and deleting need the database id,
  // which a message only has once it has been
  // saved. A reply still streaming has none, so
  // there is nothing to offer.

  async function editMessage(
    message: ChatMessage,
    content: string
  ) {
    if (!currentProject || !message.id) {
      return;
    }

    const response = await fetch(
      `/api/projects/${currentProject.id}/messages`,
      {
        method: "PATCH",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          id: message.id,
          content,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      setNotice(
        data.error || "Could not edit that."
      );

      return;
    }

    setMessages((previous) =>
      previous.map((item) =>
        item.localId === message.localId
          ? {
              ...item,
              content,
              edited_at: data.message?.edited_at,
            }
          : item
      )
    );
  }


  async function deleteMessage(
    message: ChatMessage
  ) {
    if (!currentProject || !message.id) {
      return;
    }

    // Off the screen first. Waiting for a round
    // trip to remove something you just deleted
    // reads as a failure.

    setMessages((previous) =>
      previous.filter(
        (item) => item.localId !== message.localId
      )
    );

    const response = await fetch(
      `/api/projects/${currentProject.id}/messages?id=${message.id}`,
      { method: "DELETE" }
    );

    if (!response.ok) {
      const data = await response.json();

      setNotice(
        data.error || "Could not delete that."
      );

      // Put it back, since it is still there.

      void loadMessages(false);
    }
  }


  function submit(text: string) {
    // Busy here, not busy everywhere. A reply
    // still writing in #general is no reason to
    // refuse a message in #design - they are
    // different conversations with different
    // agents.

    if (
      (!text.trim() && pending.length === 0) ||
      !currentProject ||
      streamingHere
    ) {
      return;
    }

    setDraft("");

    const attachmentIds = pending.map(
      (item) => item.id
    );

    const attached = pending;

    setPending([]);


    // Naming a teammate makes this their message,
    // not the agent's cue. Post it and stay out of
    // the way - people talking to each other in a
    // shared channel do not need a third voice.
    //
    // Unless the agent was asked for by name, in
    // which case both are true at once.

    if (
      findMentioned(text.trim(), members).length >
        0 &&
      !mentionsAgent(text.trim())
    ) {
      const posted: ChatMessage = {
        localId: newLocalId(),
        role: "user",
        sender: "you",
        content: text.trim(),
        projectId: currentProject.id,
        channelId: currentChannel?.id ?? null,
        attachmentIds,
        attachments: attached,
      };

      setMessages([...messages, posted]);

      void persistMessage(posted);

      return;
    }

    send({
      text: text.trim(),
      projectId: currentProject.id,
      channelId: currentChannel?.id ?? null,
      projectName: currentProject.name,
      channelName: currentChannel?.name,
      settings,
      history: messages,
      attachmentIds,
      attachments: attached,
    });
  }

  // Re-runs the same turn, this time carrying
  // the grant, so the blocked tool can proceed.

  function approve(approval: ApprovalRequest) {
    if (!currentProject) {
      return;
    }

    let lastUserIndex = -1;

    for (
      let index = messages.length - 1;
      index >= 0;
      index--
    ) {
      if (messages[index].role === "user") {
        lastUserIndex = index;
        break;
      }
    }

    if (lastUserIndex === -1) {
      return;
    }

    send({
      text: messages[lastUserIndex].content,
      projectId: currentProject.id,
      channelId: currentChannel?.id ?? null,
      projectName: currentProject.name,
      channelName: currentChannel?.name,
      settings,
      history: messages.slice(
        0,
        lastUserIndex + 1
      ),
      skipUserMessage: true,
      approvals: [approval],
    });
  }

  function regenerate() {
    if (!currentProject) {
      return;
    }

    // Find the turn we are answering again.

    let lastUserIndex = -1;

    for (
      let index = messages.length - 1;
      index >= 0;
      index--
    ) {
      if (messages[index].role === "user") {
        lastUserIndex = index;
        break;
      }
    }

    if (lastUserIndex === -1) {
      return;
    }

    // Everything up to and including that turn,
    // dropping the reply being replaced.

    send({
      text: messages[lastUserIndex].content,
      projectId: currentProject.id,
      channelId: currentChannel?.id ?? null,
      projectName: currentProject.name,
      channelName: currentChannel?.name,
      settings,
      history: messages.slice(
        0,
        lastUserIndex + 1
      ),
      skipUserMessage: true,
    });
  }


  // ----------------------------------------
  // RENDER
  // ----------------------------------------

  // The same sidebar in both places. In the
  // drawer, choosing anything also closes it.

  function sidebarFor(inDrawer: boolean) {
    const then =
      <T extends unknown[]>(action: (...args: T) => void) =>
      (...args: T) => {
        action(...args);

        if (inDrawer) {
          setDrawerOpen(false);
        }
      };

    return (
      <Sidebar
        projects={projects}
        currentProject={currentProject}
        onSelectProject={then((project: Project) => {
          setCurrentProject(project);
          setActiveMember(null);
        })}
        onCreateProject={then(() => setAsking("project"))}
        onRenameProject={(project: Project) => {
          const name = window.prompt(
            "Rename project",
            project.name
          );

          if (name && name.trim()) {
            void renameProject(project, name);
          }
        }}

        unreadChannels={unreadChannels}
        unreadDMs={unreadDMs}

        channels={channels}
        currentChannel={currentChannel}
        onSelectChannel={then((channel: Channel) => {
          setCurrentChannel(channel);
          setActiveMember(null);
        })}
        onCreateChannel={then(() => setAsking("channel"))}
        onRenameChannel={(channel: Channel) => {
          const name = window.prompt(
            "Rename channel",
            channel.name
          );

          if (name && name.trim()) {
            void renameChannel(channel, name);
          }
        }}
        onDeleteChannel={(channel: Channel) => {
          if (
            window.confirm(
              `Delete #${channel.name}? This removes its messages and agent, and can't be undone.`
            )
          ) {
            void deleteChannel(channel);
          }
        }}
        onChannelAccess={(channel: Channel) =>
          setAccessFor(channel)
        }
        channelsNeedMigration={channelsNeedMigration}
        myRole={myRole}

        members={members}
        activeMemberId={activeMember?.id ?? null}
        onOpenDM={then((member: Member) => setActiveMember(member))}

        onOpenSettings={then(() => setSettingsOpen(true))}
      />
    );
  }


  return (
    <main className="flex h-dvh bg-[var(--bg)] text-[var(--text)]">

      {/* Wider screens: beside the conversation, */}
      {/* resizable and hideable.                 */}

      {sidebar.hidden ? (
        <div className="hidden md:flex">
          <CollapsedRail onShow={sidebar.toggle} />
        </div>
      ) : (
      <div
        className="relative hidden h-full shrink-0 md:block"
        style={{ width: sidebar.width }}
      >
        {sidebarFor(false)}

        <ResizeHandle
          width={sidebar.width}
          onResize={sidebar.setWidth}
          onHide={sidebar.hide}
        />
      </div>
      )}

      {/* Phones: a drawer over everything. */}

      {drawer.mounted && (
        <div className={`fixed inset-0 z-40 flex md:hidden${drawer.closing ? " pointer-events-none" : ""}`}>
          <div className={`t-drawer-left${drawer.closing ? " is-closing" : ""} relative z-10 h-full w-[min(300px,85vw)] shadow-2xl shadow-black/60`}>
            {sidebarFor(true)}
          </div>

          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className={`t-overlay${drawer.closing ? " is-closing" : ""} flex-1 bg-black/50`}
          />
        </div>
      )}


      {activeMember ? (
        <DMView
          key={activeMember.id}
          member={activeMember}
          onOpenMenu={() => setDrawerOpen(true)}
          onRead={markDMRead}
        />
      ) : (
        <section className="flex min-w-0 flex-1 flex-col">

          {/* HEADER */}

          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 sm:px-5">
            <MenuButton onClick={() => setDrawerOpen(true)} />

            <Hash className="h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" />

            <h1 className="min-w-0 truncate text-[13px] font-medium text-[var(--text)]">
              {currentChannel?.name ??
                currentProject?.name ??
                "No project"}
            </h1>

            <div className="ml-auto flex shrink-0 items-center gap-2">
              {/* The project's short handle, so people
                  can say which project they mean. */}
              {currentProject && (
                <span
                  title="Project code"
                  className="font-mono text-[11px] tracking-tight text-[var(--text-faint)]"
                >
                  #{currentProject.id.slice(0, 6)}
                </span>
              )}

              <NotificationBell
                onOpenChannel={(channelId) => {
                  const target = channels.find(
                    (channel) =>
                      channel.id === channelId
                  );

                  if (target) {
                    setCurrentChannel(target);
                    setActiveMember(null);
                  }
                }}
              />

              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                title="Search (Ctrl+K)"
                aria-label="Search"
                className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[var(--text-faint)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-muted)] sm:h-6 sm:border sm:border-[var(--border)]"
              >
                <SearchIcon className="h-4 w-4 sm:h-3 sm:w-3" />

                <kbd className="hidden font-mono text-[10px] sm:inline">
                  ⌘K
                </kbd>
              </button>

              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  health.online
                    ? "bg-emerald-500"
                    : "bg-red-500"
                }`}
              />

              <span className="hidden font-mono text-[11px] text-[var(--text-faint)] sm:inline">
                {health.model || "…"}
              </span>
            </div>
          </header>


          {/* MESSAGES */}

          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="flex-1 overflow-y-auto px-3 py-4 sm:px-5 sm:py-6"
          >
            <div className="mx-auto max-w-3xl space-y-6">
              {loadingMessages ? (
                <p className="text-[13px] text-[var(--text-faint)]">
                  Loading conversation…
                </p>
              ) : messages.length === 0 ? (
                <div className="pt-16">
                  <h2 className="text-[15px] font-medium text-[var(--text)]">
                    {currentProject
                      ? "What are we working on?"
                      : "Create a project to begin"}
                  </h2>

                  <p className="mt-1 text-[13px] text-[var(--text-faint)]">
                    Ask anything, or start with one of these.
                  </p>

                  {!hasGemini && (
                    <button
                      type="button"
                      onClick={() => {
                        setSettingsTab("ai");
                        setSettingsOpen(true);
                      }}
                      className="mt-3 text-left text-[12.5px] text-[var(--text-muted)] underline decoration-[var(--border-strong)] underline-offset-4 transition hover:text-[var(--text)]"
                    >
                      Want faster, smarter answers? Connect a free Google Gemini key →
                    </button>
                  )}

                  {currentProject && (
                    <div className="mt-5 flex flex-wrap gap-2">
                      {(
                        templateById(
                          channelTemplate?.channelId ===
                            currentChannel?.id
                            ? channelTemplate?.templateId
                            : null
                        )?.starters ?? SUGGESTIONS
                      ).map(
                        (suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            onClick={() => {
                              // A finished question
                              // goes straight away.
                              // One that trails off -
                              // "Compare the top 3
                              // tools for" - is
                              // waiting for the rest,
                              // so it goes into the
                              // box to be finished.

                              if (
                                SUGGESTIONS.includes(
                                  suggestion
                                ) ||
                                /[?.!]$/.test(
                                  suggestion
                                )
                              ) {
                                void submit(suggestion);

                                return;
                              }

                              setDraft(
                                suggestion.endsWith(":")
                                  ? `${suggestion}
`
                                  : `${suggestion} `
                              );

                              document
                                .querySelector<HTMLTextAreaElement>(
                                  "textarea"
                                )
                                ?.focus();
                            }}
                            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[12.5px] text-[var(--text-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--text)]"
                          >
                            {suggestion}
                          </button>
                        )
                      )}
                    </div>
                  )}
                </div>
              ) : (
                messages.map(
                  (message, index) => (
                    <MessageRow
                      key={message.localId}
                      message={message}
                      projectId={currentProject?.id ?? null}
                      isLast={
                        index ===
                        messages.length - 1
                      }
                      onRegenerate={
                        message.role ===
                          "assistant" &&
                        myRole !== "viewer"
                          ? regenerate
                          : undefined
                      }
                      onEdit={
                        message.id &&
                        message.sender === "you"
                          ? (content) =>
                              editMessage(
                                message,
                                content
                              )
                          : undefined
                      }
                      onDelete={
                        message.id &&
                        message.sender !==
                          "teammate" &&
                        myRole !== "viewer"
                          ? () =>
                              deleteMessage(
                                message
                              )
                          : undefined
                      }
                      onApprove={
                        myRole === "viewer"
                          ? undefined
                          : approve
                      }
                    />
                  )
                )
              )}

              <div ref={bottomRef} />
            </div>
          </div>


          <AgentDock
            projectId={currentProject?.id ?? null}
            channelId={currentChannel?.id ?? null}
            channelName={currentChannel?.name ?? null}
            readOnly={myRole === "viewer"}
          />


          {/* COMPOSER */}

          {myRole === "viewer" ? (
            <div className="border-t border-[var(--border)] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <p className="mx-auto max-w-3xl rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2 text-center text-[12.5px] text-[var(--text-muted)]">
                You are a viewer here: you can read this channel, but not post or ask its agent.
              </p>
            </div>
          ) : (
          <Composer
            value={draft}
            onChange={setDraft}
            attachments={pending}
            uploadingIds={uploadingIds}
            members={members}
            onAttach={attach}
            onRemoveAttachment={(id) =>
              setPending((previous) =>
                previous.filter(
                  (item) => item.id !== id
                )
              )
            }
            onSend={() => submit(draft)}
            onStop={() => stop(here)}

            showModel
            onOpenModelSettings={() => {
              setSettingsTab("ai");
              setSettingsOpen(true);
            }}
            modelChannelId={
              currentChannel?.id ?? null
            }
            modelProjectId={
              currentProject?.id ?? null
            }
            contextTokens={
              lastUsage?.promptTokens
            }
            lastTurnTokens={
              lastUsage?.responseTokens
            }
            streaming={streamingHere}
            status={statusHere}
            disabled={!currentProject}
            placeholder={
              currentProject
                ? `Message ${
                    currentChannel
                      ? `#${currentChannel.name}`
                      : currentProject.name
                  }`
                : "Create a project first"
            }
          />
          )}
        </section>
      )}


      {searchOpen && (
        <SearchPalette
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          projectId={currentProject?.id ?? null}
          channels={channels}
          onGoToChannel={(channel) => {
            setCurrentChannel(channel);
            setActiveMember(null);
          }}
        />
      )}

      {settingsOpen && (
        <SettingsPanel
          open={settingsOpen}
          startTab={settingsTab}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsTab(undefined);
          }}
          settings={settings}
          onChange={setSettings}
          projectId={currentProject?.id ?? null}
          channelId={currentChannel?.id ?? null}
          model={health.model}
          online={health.online}
        />
      )}


      {/* ------------------------------ */}
      {/* SOMETHING WENT WRONG           */}
      {/* ------------------------------ */}

      {notice && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center px-4 sm:bottom-6 sm:px-6">
          <div className="pointer-events-auto flex max-w-[420px] items-start gap-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-raised)] px-3.5 py-2.5 shadow-xl">
            <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-[var(--text)]">
              {notice}
            </p>

            <button
              type="button"
              onClick={() => setNotice("")}
              aria-label="Dismiss"
              className="-mt-0.5 shrink-0 rounded px-1 text-[12.5px] text-[var(--text-faint)] transition hover:text-[var(--text)]"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}


      {/* ------------------------------ */}
      {/* NAMING SOMETHING NEW           */}
      {/* ------------------------------ */}

      <PromptDialog
        open={asking === "project"}
        title="New project"
        description="A project holds its channels, its people and its agents."
        label="Name"
        placeholder="Website redesign"
        confirmLabel="Create project"
        onSubmit={createProject}
        onClose={() => setAsking(null)}
      />

      {projectsLoaded &&
        projects.length === 0 &&
        !setupDone && (
          <FirstRun
            onFinished={({ project, channel, templateId }) => {
              setSetupDone(true);

              if (!project) {
                return;
              }

              // The channel list loads when the
              // project changes, and opens whichever
              // channel was saved last - so saving
              // this one first lands them in it.

              if (channel) {
                localStorage.setItem(
                  CHANNEL_KEY,
                  channel.id
                );

                setChannelTemplate({
                  channelId: channel.id,
                  templateId,
                });
              }

              setProjects([project]);
              setCurrentProject(project);
              setActiveMember(null);
            }}
          />
        )}

      {accessFor && currentProject && (
        <ChannelAccessDialog
          projectId={currentProject.id}
          channel={accessFor}
          onClose={() => setAccessFor(null)}
          onSaved={(saved) => {
            setChannels((previous) =>
              previous.map((channel) =>
                channel.id === saved.id ? saved : channel
              )
            );

            setCurrentChannel((current) =>
              current?.id === saved.id ? saved : current
            );
          }}
        />
      )}

      {asking === "channel" && (
        <NewChannelDialog
          open
          onCreate={createChannel}
          onClose={() => setAsking(null)}
        />
      )}

      {/* An established user on the shared AI key is
          offered their own free Groq key, once. */}
      <ConnectGroq
        enabled={projectsLoaded && projects.length > 0}
      />

      {/* And their own image key, the first time they
          generate an image. */}
      <ConnectCloudflare />
    </main>
  );
}
