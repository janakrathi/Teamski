import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type {
  AppState,
  Approval,
  ApprovalDecision,
  PermissionMode,
  ProviderId,
  TodoItem,
  UiItem,
} from "../shared/types.ts";
import { api, modelLabel } from "./api.ts";

// ------------------------------------------
// ICONS
// ------------------------------------------

type IconProps = { size?: number };

const svg = (size: number, children: React.ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

export const IconWorkspace = ({ size = 20 }: IconProps) =>
  svg(size, <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>);
export const IconCode = ({ size = 20 }: IconProps) =>
  svg(size, <><path d="m8 7-5 5 5 5" /><path d="m16 7 5 5-5 5" /><path d="m13.5 4-3 16" /></>);
export const IconSettings = ({ size = 20 }: IconProps) =>
  svg(size, <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>);
export const IconFolder = ({ size = 16 }: IconProps) =>
  svg(size, <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />);
export const IconDownload = ({ size = 20 }: IconProps) =>
  svg(size, <><path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" /></>);
export const IconPlus = ({ size = 16 }: IconProps) => svg(size, <><path d="M12 5v14" /><path d="M5 12h14" /></>);
export const IconBack = ({ size = 16 }: IconProps) => svg(size, <path d="m15 18-6-6 6-6" />);
export const IconSend = ({ size = 16 }: IconProps) => svg(size, <><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></>);
export const IconStop = ({ size = 14 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
);
export const IconTrash = ({ size = 14 }: IconProps) =>
  svg(size, <><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /></>);
const IconCheck = ({ size = 13 }: IconProps) => svg(size, <path d="m5 12 5 5 9-10" />);
const IconCross = ({ size = 13 }: IconProps) => svg(size, <><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>);
const IconBan = ({ size = 13 }: IconProps) => svg(size, <><circle cx="12" cy="12" r="8" /><path d="m6.5 6.5 11 11" /></>);
const IconChevron = ({ size = 12 }: IconProps) => svg(size, <path d="m6 9 6 6 6-6" />);

// ------------------------------------------
// MARKDOWN
// ------------------------------------------
//
// react-markdown never renders raw HTML, so nothing a
// model writes can run in this window.

export function Markdown({ text }: { text: string }) {
  return (
    <div className="msg-assistant">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(event) => {
                event.preventDefault();
                if (href) void api().openExternal(href);
              }}
            >
              {children}
            </a>
          ),
          img: ({ alt }) => <span>[image: {alt}]</span>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

// ------------------------------------------
// DIFFS AND TOOL ROWS
// ------------------------------------------

export function Diff({ text }: { text: string }) {
  const lines = text.split("\n");

  return (
    <div className="diff">
      {lines.map((line, index) => {
        const kind =
          line.startsWith("+++") || line.startsWith("---")
            ? "hunk"
            : line.startsWith("@@")
              ? "hunk"
              : line.startsWith("+")
                ? "add"
                : line.startsWith("-")
                  ? "del"
                  : "ctx";

        return (
          <div key={index} className={kind}>
            {line || " "}
          </div>
        );
      })}
    </div>
  );
}

function Note({ note }: { note?: string }) {
  if (!note) return null;

  const diff = /^\+(\d+) -(\d+)$/.exec(note);

  if (diff) {
    return (
      <span className="note">
        <span className="add">+{diff[1]}</span> <span className="del">-{diff[2]}</span>
      </span>
    );
  }

  return <span className="note">{note}</span>;
}

export function ToolRow({ item }: { item: Extract<UiItem, { kind: "tool" }> }) {
  const live = item.status === "running" && item.name === "run_command";
  const [open, setOpen] = useState(false);
  const shown = open || live;
  const body = item.diff || item.output;

  return (
    <div className="tool">
      <button className="tool-head" onClick={() => setOpen(!open)} title={item.summary}>
        <span className={`status ${item.status}`}>
          {item.status === "running" ? (
            <span className="spinner" />
          ) : item.status === "ok" ? (
            <IconCheck />
          ) : item.status === "denied" ? (
            <IconBan />
          ) : (
            <IconCross />
          )}
        </span>
        <span className="label">{item.summary}</span>
        <Note note={item.status === "denied" ? "declined" : item.note} />
      </button>

      {shown && body ? (
        <div className="tool-body">
          {item.diff ? <Diff text={item.diff} /> : <pre className="output">{item.output}</pre>}
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------
// APPROVAL
// ------------------------------------------

export function ApprovalCard({
  approval,
  onDecide,
}: {
  approval: Approval;
  onDecide: (decision: ApprovalDecision) => void;
}) {
  const [feedback, setFeedback] = useState("");

  const sessionLabel =
    approval.tool === "run_command"
      ? approval.commandPrefix
        ? `Always allow "${approval.commandPrefix}"${approval.network ? " online" : ""}`
        : null
      : approval.tool === "fetch_url"
        ? "Allow web fetches this session"
        : approval.tool === "mcp"
          ? `Always allow ${approval.commandPrefix ?? "this server"}`
          : "Allow all edits this session";

  const question =
    approval.tool === "run_command"
      ? approval.network
        ? "Run with internet access?"
        : "Run this command?"
      : approval.tool === "fetch_url"
        ? "Fetch this page?"
        : approval.tool === "mcp"
          ? "Use this tool?"
          : "Make this change?";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = (event.target as HTMLElement)?.tagName === "INPUT" || (event.target as HTMLElement)?.tagName === "TEXTAREA";
      if (typing) return;

      if (event.key === "Enter") {
        event.preventDefault();
        onDecide({ kind: "allow" });
      } else if (event.key === "Escape") {
        event.preventDefault();
        onDecide({ kind: "deny" });
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [approval.requestId, onDecide]);

  return (
    <div className="approval">
      <div className="ask">
        <span>{question}</span>
        <span className="what">{approval.title}</span>
      </div>

      {approval.detail ? (
        approval.detailKind === "diff" ? (
          <div className="tool-body">
            <Diff text={approval.detail} />
          </div>
        ) : (
          <div className="command">{approval.detail}</div>
        )
      ) : null}

      <div className="actions">
        <button className="btn primary" onClick={() => onDecide({ kind: "allow" })}>
          Allow <span className="kbd">↵</span>
        </button>
        {sessionLabel ? (
          <button className="btn" onClick={() => onDecide({ kind: "allow-session" })}>
            {sessionLabel}
          </button>
        ) : null}
        <input
          className="feedback"
          placeholder="Or tell it what to do instead…"
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onDecide({ kind: "deny", feedback: feedback.trim() || undefined });
            }
          }}
        />
        <button className="btn" onClick={() => onDecide({ kind: "deny", feedback: feedback.trim() || undefined })}>
          Deny <span className="kbd">esc</span>
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------
// TODOS
// ------------------------------------------

export function Todos({ todos }: { todos: TodoItem[] }) {
  const [open, setOpen] = useState(true);

  if (!todos.length) return null;

  const done = todos.filter((todo) => todo.status === "completed").length;

  return (
    <div className="todos">
      <div className="head">
        <span>
          Tasks · {done}/{todos.length}
        </span>
        <button className="link" onClick={() => setOpen(!open)}>
          {open ? "hide" : "show"}
        </button>
      </div>
      {open &&
        todos.map((todo, index) => (
          <div key={index} className={`todo ${todo.status}`}>
            <span className="box">{todo.status === "completed" ? <IconCheck size={10} /> : null}</span>
            <span>{todo.content}</span>
          </div>
        ))}
    </div>
  );
}

// ------------------------------------------
// MENUS
// ------------------------------------------

function useOutside(onOutside: () => void) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const listener = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onOutside();
    };
    window.addEventListener("mousedown", listener);
    return () => window.removeEventListener("mousedown", listener);
  }, [onOutside]);

  return ref;
}

const MODES: { id: PermissionMode; label: string; desc: string }[] = [
  { id: "ask", label: "Ask first", desc: "Approve every edit and command" },
  { id: "auto-edit", label: "Auto-edit", desc: "Edits go ahead; commands are approved" },
  { id: "full-auto", label: "Full auto", desc: "No questions (risky commands still ask)" },
];

export function ModePicker({ mode, onChange, up }: { mode: PermissionMode; onChange: (mode: PermissionMode) => void; up?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(() => setOpen(false));
  const current = MODES.find((entry) => entry.id === mode) ?? MODES[0];

  return (
    <div className="menu-wrap" ref={ref}>
      <button className="btn ghost" onClick={() => setOpen(!open)} title="Who decides before the agent changes things">
        {current.label} <IconChevron />
      </button>
      {open && (
        <div className={`menu ${up ? "up" : "down"}`}>
          {MODES.map((entry) => (
            <button
              key={entry.id}
              className={`item ${entry.id === mode ? "on" : ""}`}
              onClick={() => {
                onChange(entry.id);
                setOpen(false);
              }}
            >
              <span>
                {entry.label}
                <span className="desc">{entry.desc}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type ModelGroup = { provider: ProviderId; label: string; models: string[]; error?: string; loading: boolean };

export function ModelPicker({
  state,
  value,
  onChange,
  onOpenSettings,
  up,
}: {
  state: AppState;
  value: string;
  onChange: (value: string) => void;
  onOpenSettings: () => void;
  up?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<ModelGroup[]>([]);
  const ref = useOutside(() => setOpen(false));

  const usable = useMemo(
    () =>
      state.providers.filter(
        (provider) => (provider.needsKey ? provider.hasKey : provider.id === "ollama" || Boolean(provider.baseUrl))
      ),
    [state.providers]
  );

  useEffect(() => {
    if (!open) return;

    let live = true;

    setGroups(usable.map((provider) => ({ provider: provider.id, label: provider.label, models: [], loading: true })));

    for (const provider of usable) {
      void api()
        .listModels(provider.id)
        .then((result) => {
          if (!live) return;
          setGroups((current) =>
            current.map((group) =>
              group.provider === provider.id
                ? { ...group, models: result.models, error: result.error, loading: false }
                : group
            )
          );
        });
    }

    return () => {
      live = false;
    };
  }, [open, usable]);

  const needle = query.trim().toLowerCase();

  return (
    <div className="menu-wrap" ref={ref}>
      <button className="btn ghost" onClick={() => setOpen(!open)} title="Model">
        {modelLabel(value)} <IconChevron />
      </button>

      {open && (
        <div className={`menu ${up ? "up" : "down"}`} style={{ minWidth: 320 }}>
          <input
            autoFocus
            className="search"
            placeholder="Search models, or type one…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />

          {!usable.length && (
            <div className="hint">
              No models yet.{" "}
              <button className="link" onClick={() => { setOpen(false); onOpenSettings(); }}>
                Add a free key
              </button>
            </div>
          )}

          {groups.map((group) => {
            const models = group.models.filter((model) => !needle || model.toLowerCase().includes(needle));
            const typed = needle && !group.models.some((model) => model.toLowerCase() === needle) ? query.trim() : null;

            if (!models.length && !typed && !group.loading && needle) return null;

            return (
              <div key={group.provider}>
                <div className="group">
                  <span>{group.label}</span>
                  {group.loading && <span>loading…</span>}
                </div>
                {group.error && <div className="err">{group.error.slice(0, 160)}</div>}
                {models.slice(0, 60).map((model) => {
                  const id = `${group.provider}::${model}`;
                  return (
                    <button
                      key={id}
                      className={`item ${id === value ? "on" : ""}`}
                      onClick={() => {
                        onChange(id);
                        setOpen(false);
                      }}
                    >
                      {model}
                    </button>
                  );
                })}
                {typed && (
                  <button
                    className="item"
                    onClick={() => {
                      onChange(`${group.provider}::${typed}`);
                      setOpen(false);
                    }}
                  >
                    Use “{typed}”
                  </button>
                )}
              </div>
            );
          })}

          <div className="hint">
            <button className="link" onClick={() => { setOpen(false); onOpenSettings(); }}>
              Manage keys…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
