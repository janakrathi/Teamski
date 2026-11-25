import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import type { AppState, ApprovalDecision, SessionView } from "../shared/types.ts";
import { api, basename, formatTokens, timeAgo } from "./api.ts";
import {
  ApprovalCard,
  IconBack,
  IconCode,
  IconFolder,
  IconPlus,
  IconSend,
  IconSettings,
  IconStop,
  IconTrash,
  IconWorkspace,
  Markdown,
  ModePicker,
  ModelPicker,
  Todos,
  ToolRow,
} from "./parts.tsx";
import { Settings } from "./settings.tsx";

// ==========================================
// THE CODE WINDOW
// ==========================================

const SUGGESTIONS = [
  "Explain how this project is structured",
  "Find and fix a bug in the failing tests",
  "Add a README with setup steps",
  "Review my uncommitted changes",
];

function Home({
  state,
  onOpenFolder,
  onFolder,
  onSession,
  onDelete,
  onSettings,
}: {
  state: AppState;
  onOpenFolder: () => void;
  onFolder: (folder: string) => void;
  onSession: (id: string) => void;
  onDelete: (id: string) => void;
  onSettings: () => void;
}) {
  const noModel = !state.settings.model;

  return (
    <div className="home">
      <div className="home-inner">
        <h1>Teamski Code</h1>
        <p className="lead">
          A coding agent that works in your own folders: it reads your code, makes changes, runs your tests and
          commands, and asks before anything risky.
        </p>

        {noModel && (
          <div className="callout">
            <div style={{ flex: 1 }}>
              <strong>Add a model to start</strong>
              <p>
                A free Groq or Gemini key takes about two minutes and gets you GPT-OSS 120B or Gemini. Or run models
                on this computer with Ollama.
              </p>
            </div>
            <button className="btn primary" onClick={onSettings}>
              Add a key
            </button>
          </div>
        )}

        <button className="btn primary big" onClick={onOpenFolder}>
          <IconFolder /> Open a folder
        </button>

        {state.settings.recentFolders.length > 0 && (
          <>
            <h2>Recent folders</h2>
            <div className="list">
              {state.settings.recentFolders.map((folder) => (
                <button key={folder} className="row" onClick={() => onFolder(folder)}>
                  <IconFolder />
                  <span className="stack">
                    <span className="name">{basename(folder)}</span>
                    <span className="sub">{folder}</span>
                  </span>
                  <span className="meta">New session →</span>
                </button>
              ))}
            </div>
          </>
        )}

        {state.sessions.length > 0 && (
          <>
            <h2>Recent sessions</h2>
            <div className="list">
              {state.sessions.slice(0, 30).map((session) => (
                <div key={session.id} className="row" role="button" tabIndex={0} onClick={() => onSession(session.id)}>
                  <span className="stack">
                    <span className="name">{session.title}</span>
                    <span className="sub">{basename(session.folder)}</span>
                  </span>
                  <span className="meta">{timeAgo(session.updatedAt)}</span>
                  <button
                    className="btn ghost delete"
                    title="Delete session"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(session.id);
                    }}
                  >
                    <IconTrash />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SessionScreen({
  state,
  session,
  onBack,
  onNew,
  onSettings,
  onState,
}: {
  state: AppState;
  session: SessionView;
  onBack: () => void;
  onNew: () => void;
  onSettings: () => void;
  onState: (state: AppState) => void;
}) {
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const pinned = useRef(true);

  // Follow the bottom while it streams, unless the
  // person scrolled up to read.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [session]);

  useEffect(() => {
    input.current?.focus();
  }, [session.id]);

  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 260)}px`;
  }, [draft]);

  const send = (text = draft) => {
    if (!text.trim() || session.running) return;
    pinned.current = true;
    void api().send(session.id, text);
    setDraft("");
  };

  const decide = useCallback(
    (decision: ApprovalDecision) => {
      if (session.approval) void api().respond(session.id, session.approval.requestId, decision);
    },
    [session.id, session.approval]
  );

  return (
    <>
      <div className="topbar">
        <button className="btn ghost" onClick={onBack} title="All sessions">
          <IconBack />
        </button>
        <span className="title">{session.title === "New session" ? "New session" : session.title}</span>
        <button className="folder" onClick={() => void api().revealFolder(session.folder)} title={session.folder}>
          {basename(session.folder)}
        </button>
        <span className="grow" />
        <button className="btn ghost" onClick={onNew} title="New session in this folder (Ctrl/Cmd+N)">
          <IconPlus /> New
        </button>
      </div>

      <div
        className="transcript"
        ref={scroller}
        onScroll={(event) => {
          const element = event.currentTarget;
          pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        }}
      >
        <div className="column">
          {session.items.length === 0 && (
            <div className="empty-session">
              <h2>What should we build in {basename(session.folder)}?</h2>
              <div>Describe a task, a bug, or a question about the code.</div>
              <div className="suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion} className="suggestion" onClick={() => send(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {session.items.map((item, index) => {
            switch (item.kind) {
              case "user":
                return (
                  <div key={index} className="msg-user">
                    {item.text}
                  </div>
                );
              case "assistant":
                return <Markdown key={index} text={item.text} />;
              case "thinking":
                return (
                  <div key={index} className="thinking">
                    {item.text}
                  </div>
                );
              case "tool":
                return <ToolRow key={item.id + index} item={item} />;
              case "notice":
                return (
                  <div key={index} className={`notice ${item.tone}`}>
                    {item.text}
                  </div>
                );
            }
          })}

          {session.running && !session.approval && (
            <div className="tool-head" style={{ cursor: "default" }}>
              <span className="status">
                <span className="spinner" />
              </span>
              <span className="label">Working…</span>
            </div>
          )}
        </div>
      </div>

      <div className="dock">
        <div className="column">
          <Todos todos={session.todos} />

          {session.approval && <ApprovalCard approval={session.approval} onDecide={decide} />}

          <div className="composer">
            <textarea
              ref={input}
              rows={1}
              value={draft}
              placeholder={session.running ? "Working… press Stop to interrupt" : "Ask Teamski to build, fix or explain something"}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  send();
                }
              }}
            />
            <div className="bar">
              <ModelPicker
                up
                state={state}
                value={session.model}
                onOpenSettings={onSettings}
                onChange={async (model) => {
                  await api().setSessionModel(session.id, model);
                  onState(await api().getState());
                }}
              />
              <ModePicker
                up
                mode={state.settings.mode}
                onChange={async (mode) => onState(await api().setSettings({ mode }))}
              />
              <span className="grow" />
              {(session.usage.input > 0 || session.usage.output > 0) && (
                <span className="usage" title="Tokens used in this session (in / out)">
                  {formatTokens(session.usage.input)} in · {formatTokens(session.usage.output)} out
                </span>
              )}
              {session.running ? (
                <button className="btn" onClick={() => void api().stop(session.id)} title="Stop">
                  <IconStop /> Stop
                </button>
              ) : (
                <button className="btn primary" disabled={!draft.trim()} onClick={() => send()} title="Send (Enter)">
                  <IconSend />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [view, setView] = useState<"workspace" | "code">("code");
  const [session, setSession] = useState<SessionView | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState("");
  const sessionId = useRef<string | null>(null);

  useEffect(() => {
    void api().getState().then(setState);

    const offState = api().onState(setState);
    const offView = api().onView(setView);
    const offSession = api().onSession((next) => {
      if (next.id === sessionId.current) setSession(next);
    });

    return () => {
      offState();
      offView();
      offSession();
    };
  }, []);

  const open = (next: SessionView | null) => {
    sessionId.current = next?.id ?? null;
    setSession(next);
  };

  const startIn = async (folder: string) => {
    setError("");
    try {
      open(await api().newSession(folder));
      setState(await api().getState());
    } catch (cause) {
      setError((cause as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    }
  };

  const openFolder = async () => {
    const folder = await api().pickFolder();
    if (folder) await startIn(folder);
  };

  // Menu shortcuts from the main process.
  const latest = useRef({ openFolder, startIn, session });
  latest.current = { openFolder, startIn, session };

  useEffect(
    () =>
      api().onCommand((command) => {
        if (command === "open-folder") void latest.current.openFolder();
        if (command === "new-session") {
          const folder = latest.current.session?.folder;
          if (folder) void latest.current.startIn(folder);
          else void latest.current.openFolder();
        }
      }),
    []
  );

  if (!state) return null;

  const mac = state.platform === "darwin";

  return (
    <div className="app">
      <nav className={`rail ${mac ? "mac" : ""}`}>
        <img className="logo" src="logo.png" alt="Teamski" />
        <button
          className={`rail-button ${view === "workspace" ? "active" : ""}`}
          onClick={() => void api().showView("workspace")}
          title={`Workspace (${mac ? "⌘" : "Ctrl+"}1)`}
        >
          <IconWorkspace />
          Workspace
        </button>
        <button
          className={`rail-button ${view === "code" ? "active" : ""}`}
          onClick={() => void api().showView("code")}
          title={`Code (${mac ? "⌘" : "Ctrl+"}2)`}
        >
          <IconCode />
          Code
        </button>
        <span className="spacer" />
        <button className="rail-button" onClick={() => setSettingsOpen(true)} title="Settings">
          <IconSettings />
          Settings
        </button>
      </nav>

      <main className="main">
        {error && (
          <div className="notice error" style={{ margin: 12 }}>
            {error}
          </div>
        )}

        {session ? (
          <SessionScreen
            state={state}
            session={session}
            onBack={() => {
              open(null);
              void api().getState().then(setState);
            }}
            onNew={() => void startIn(session.folder)}
            onSettings={() => setSettingsOpen(true)}
            onState={setState}
          />
        ) : (
          <Home
            state={state}
            onOpenFolder={() => void openFolder()}
            onFolder={(folder) => void startIn(folder)}
            onSession={async (id) => open(await api().openSession(id))}
            onDelete={async (id) => setState(await api().deleteSession(id))}
            onSettings={() => setSettingsOpen(true)}
          />
        )}
      </main>

      {settingsOpen && <Settings state={state} onState={setState} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
