// ==========================================
// SHARED TYPES - MAIN PROCESS <-> CODE WINDOW
// ==========================================
//
// The main process owns every session: it runs the
// agent, keeps the transcript and saves it. The Code
// window only renders snapshots of a session and
// sends back what the person typed or decided.
//

export type ProviderId =
  | "anthropic"
  | "openai"
  | "google"
  | "groq"
  | "cerebras"
  | "openrouter"
  | "deepseek"
  | "mistral"
  | "xai"
  | "ollama"
  | "custom";

// How a provider is spoken to.
//   openai    - OpenAI's chat completions API (most providers)
//   anthropic - Anthropic's messages API
//   ollama    - Ollama's own API, so the context size can be set
export type ProviderKind = "openai" | "anthropic" | "ollama";

export type ProviderInfo = {
  id: ProviderId;
  label: string;
  kind: ProviderKind;
  needsKey: boolean;
  hasKey: boolean;
  // Where to get a key, shown in Settings.
  keyUrl?: string;
  // A short line under the provider in Settings.
  note?: string;
  free?: boolean;
  // Editable address (Ollama, custom).
  baseUrl?: string;
  editableUrl?: boolean;
};

// Who decides before the agent changes something.
//   ask       - every edit and command is approved first
//   auto-edit - file edits go ahead; commands are approved
//   full-auto - nothing is asked (inside the folder)
export type PermissionMode = "ask" | "auto-edit" | "full-auto";

export type Settings = {
  // "provider::model", e.g. "groq::openai/gpt-oss-120b".
  model: string;
  mode: PermissionMode;
  recentFolders: string[];
  // Show the model's reasoning when it streams one.
  showThinking: boolean;
  // Run commands in the sandbox (no network, see
  // main/sandbox.ts). On by default.
  sandbox: boolean;
};

export type McpServerState = {
  name: string;
  status: "connecting" | "connected" | "error" | "disabled";
  error?: string;
  tools: number;
};

export type UpdateInfo = {
  version: string;
  notesUrl: string;
  downloadUrl: string;
  size: number;
  // Windows installs it in place; a Mac opens the download.
  canInstall: boolean;
};

export type UpdateState = UpdateInfo & {
  // 0..1 while downloading, null otherwise.
  progress: number | null;
  error?: string;
};

export type Account = {
  email: string;
  name: string;
};

export type SandboxInfo = {
  strong: boolean;
  detail: string;
};

export type TodoItem = {
  content: string;
  status: "pending" | "in_progress" | "completed";
};

export type UiItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "thinking"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      summary: string;
      status: "running" | "ok" | "error" | "denied";
      // A short result: "+4 -2", "exit 0", "12 matches".
      note?: string;
      output?: string;
      diff?: string;
    }
  | { kind: "notice"; text: string; tone: "info" | "error" };

export type Approval = {
  requestId: string;
  tool: string;
  // One line: "Edit src/app.ts", "Run npm test".
  title: string;
  // A diff for an edit, the command for a command.
  detail?: string;
  detailKind: "diff" | "command" | "text";
  // The command's first words, offered as "always allow".
  commandPrefix?: string;
  // A command that asked to run outside the sandbox,
  // with the network.
  network?: boolean;
};

export type ApprovalDecision =
  | { kind: "allow" }
  | { kind: "allow-session" }
  | { kind: "deny"; feedback?: string };

export type SessionSummary = {
  id: string;
  title: string;
  folder: string;
  updatedAt: number;
};

export type SessionView = SessionSummary & {
  model: string;
  running: boolean;
  items: UiItem[];
  todos: TodoItem[];
  approval: Approval | null;
  usage: { input: number; output: number };
  // Indexes of user messages that can be undone back to.
  undoable: number[];
};

export type AppState = {
  platform: NodeJS.Platform;
  version: string;
  settings: Settings;
  providers: ProviderInfo[];
  sessions: SessionSummary[];
  workspaceUrl: string;
  mcp: McpServerState[];
  sandbox: SandboxInfo;
  // Signed in to Teamski (in the Workspace tab), or null.
  account: Account | null;
  // A newer version, when there is one.
  update: UpdateState | null;
};

export type ModelOption = {
  provider: ProviderId;
  id: string;
};

// What the Code window can call. Exposed by the
// preload as window.teamski.
export type DesktopApi = {
  getState(): Promise<AppState>;
  setSettings(patch: Partial<Settings>): Promise<AppState>;
  setKey(provider: ProviderId, key: string | null): Promise<AppState>;
  setBaseUrl(provider: ProviderId, url: string): Promise<AppState>;
  listModels(provider: ProviderId): Promise<{ models: string[]; error?: string }>;
  pickFolder(): Promise<string | null>;
  newSession(folder: string): Promise<SessionView>;
  openSession(id: string): Promise<SessionView | null>;
  deleteSession(id: string): Promise<AppState>;
  send(sessionId: string, text: string): Promise<void>;
  stop(sessionId: string): Promise<void>;
  setSessionModel(sessionId: string, model: string): Promise<void>;
  respond(sessionId: string, requestId: string, decision: ApprovalDecision): Promise<void>;
  // Undo everything from this user message on: files
  // the agent changed go back, the conversation is cut
  // there, and the message comes back to the composer.
  rewind(sessionId: string, itemIndex: number): Promise<{ text: string; restored: number; view: SessionView } | null>;
  openConfig(which: "mcp" | "hooks"): Promise<void>;
  // Open the Workspace tab on teamski.in's sign-in page.
  login(mode: "signin" | "signup"): Promise<void>;
  checkAccount(): Promise<AppState>;
  // Download and install the newer version (Windows), or
  // open its download (Mac).
  installUpdate(): Promise<void>;
  reloadMcp(): Promise<AppState>;
  showView(view: "workspace" | "code"): Promise<void>;
  openExternal(url: string): Promise<void>;
  revealFolder(folder: string): Promise<void>;
  onSession(callback: (view: SessionView) => void): () => void;
  onState(callback: (state: AppState) => void): () => void;
};
