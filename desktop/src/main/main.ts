import {
  BrowserWindow,
  Menu,
  WebContentsView,
  app,
  dialog,
  ipcMain,
  session as electronSession,
  shell,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from "electron";
import { statSync } from "node:fs";
import path from "node:path";

import type { Account, AppState, ApprovalDecision, ProviderId, SandboxInfo, SessionView, Settings, UpdateState } from "../shared/types.ts";
import { Session, newSessionData, type ResolvedModel, type SessionData } from "./agent.ts";
import { HOOKS_TEMPLATE } from "./hooks.ts";
import { MCP_TEMPLATE, McpHub } from "./mcp.ts";
import { listModels } from "./models.ts";
import { sandboxStatus } from "./sandbox.ts";
import { checkForUpdate, downloadInstaller, runInstaller } from "./update.ts";
import { presetFor, splitModel } from "./providers.ts";
import { adoptLoginPath } from "./shell.ts";
import * as store from "./store.ts";

// ==========================================
// TEAMSKI DESKTOP
// ==========================================
//
// One window, two halves:
//   Workspace - teamski.in itself, in a locked-down
//     view with no access to this computer at all.
//   Code - the app's own UI, where the coding agent
//     works in a folder the person picked.
//
// Only the Code UI (a local file) gets the bridge to
// the agent; nothing loaded from the web does.
//

const WORKSPACE_URL = process.env.TEAMSKI_URL || "https://teamski.in";
const RAIL = 64;

let win: BrowserWindow | null = null;
let workspace: WebContentsView | null = null;

const sessions = new Map<string, Session>();

let hub: McpHub | null = null;

function mcp() {
  if (!hub) hub = new McpHub(store.configPath("mcp"));
  return hub;
}

let sandboxInfo: SandboxInfo = { strong: false, detail: "Checking the sandbox…" };

// ------------------------------------------
// MODELS
// ------------------------------------------

function resolveModel(value: string): ResolvedModel {
  const split = splitModel(value);

  if (!split) {
    return {
      error: "Pick a model first: open Settings and add a key - a free Groq or Gemini key takes two minutes - or connect Ollama.",
    };
  }

  const preset = presetFor(split.provider)!;
  const key = store.getKey(split.provider);
  const baseUrl = store.baseUrlFor(split.provider);

  if (preset.needsKey && !key) {
    return { error: `There's no ${preset.label} key on this computer. Add it in Settings, or pick another model.` };
  }

  if (!baseUrl) {
    return { error: `${preset.label} needs an address. Set it in Settings.` };
  }

  return {
    provider: split.provider,
    kind: preset.kind,
    baseUrl,
    key,
    model: split.model,
    streamUsage: preset.streamUsage,
  };
}

// ------------------------------------------
// SESSIONS
// ------------------------------------------

const wasRunning = new Map<string, boolean>();

function emit(view: SessionView) {
  win?.webContents.send("session", view);

  // When a run ends the list (titles, order) changed.
  if (wasRunning.get(view.id) && !view.running) {
    pushState();
  }

  wasRunning.set(view.id, view.running);
}

function makeSession(data: SessionData) {
  const session = new Session(
    data,
    {
      resolveModel,
      mode: () => store.getSettings().mode,
      showThinking: () => store.getSettings().showThinking,
      sandbox: async () =>
        store.getSettings().sandbox
          ? { enabled: true, strong: (await sandboxStatus(data.folder)).strong }
          : { enabled: false, strong: false },
      save: (snapshot) => store.saveSession(snapshot),
      saveCheckpoints: (id, checkpoints) => store.saveCheckpoints(id, checkpoints),
      emit,
      hooksFile: store.configPath("hooks"),
      mcp: {
        ensure: async () => {
          await mcp().ensure();
          pushState();
        },
        schemas: () => mcp().schemas(),
        call: (name, args, signal) => mcp().call(name, args, signal),
      },
    },
    store.loadCheckpoints(data.id)
  );

  sessions.set(data.id, session);
  return session;
}

function getSession(id: string) {
  const open = sessions.get(id);
  if (open) return open;

  const data = store.loadSession(id);
  return data ? makeSession(data) : null;
}

function state(): AppState {
  return {
    platform: process.platform,
    version: app.getVersion(),
    settings: store.getSettings(),
    providers: store.providerInfo(),
    sessions: store.listSessions(),
    workspaceUrl: WORKSPACE_URL,
    mcp: hub ? hub.states() : [],
    sandbox: sandboxInfo,
    account,
    update,
  };
}

// ------------------------------------------
// UPDATES
// ------------------------------------------

let update: UpdateState | null = null;

// For trying the button in development:
// TEAMSKI_PRETEND_VERSION=0.0.1 npm start
function currentVersion() {
  return (!app.isPackaged && process.env.TEAMSKI_PRETEND_VERSION) || app.getVersion();
}

async function lookForUpdate() {
  try {
    const found = await checkForUpdate(currentVersion());

    if (found && found.version !== update?.version) {
      update = { ...found, progress: null };
      pushState();
    }
  } catch {
    // Offline or rate-limited: try again later.
  }
}

async function installUpdate() {
  if (!update || update.progress !== null) return;

  if (!update.canInstall) {
    void shell.openExternal(update.downloadUrl);
    return;
  }

  update = { ...update, progress: 0, error: undefined };
  pushState();

  try {
    let last = 0;
    const file = await downloadInstaller(update, (fraction) => {
      if (fraction - last >= 0.02 || fraction === 1) {
        last = fraction;
        update = update && { ...update, progress: fraction };
        pushState();
      }
    });

    // A development run only downloads; it never installs
    // over the copy in Program Files.
    if (!app.isPackaged) {
      shell.showItemInFolder(file);
      update = update && { ...update, progress: null, error: "Downloaded (development run, not installed)." };
      pushState();
      return;
    }

    runInstaller(file);
    app.quit();
  } catch (error) {
    update = update && { ...update, progress: null, error: (error as Error).message };
    pushState();
  }
}

function pushState() {
  win?.webContents.send("state", state());
}

// ------------------------------------------
// THE TEAMSKI ACCOUNT
// ------------------------------------------
//
// Teamski Code needs a Teamski account. The Workspace
// tab is teamski.in itself, so being signed in there is
// being signed in: the app asks the site who that is,
// with the workspace's own cookies. The last answer is
// remembered, so a moment offline doesn't sign anyone
// out.

let account: Account | null = store.getAccount();

function workspaceSession() {
  return electronSession.fromPartition("persist:workspace");
}

async function checkAccount() {
  try {
    const response = await workspaceSession().fetch(`${WORKSPACE_URL}/api/profile`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    let next: Account | null = account;

    if (response.status === 401 || response.status === 403) {
      next = null;
    } else if (response.ok) {
      const data = (await response.json()) as { profile?: { email?: string | null; display_name?: string | null; username?: string | null } };
      const profile = data.profile ?? {};
      next = { email: profile.email ?? "", name: profile.display_name || profile.username || "" };
    }

    if (JSON.stringify(next) !== JSON.stringify(account)) {
      account = next;
      store.setAccount(account);
      pushState();
    }
  } catch {
    // Offline: keep what we knew.
  }
}

let accountTimer: ReturnType<typeof setTimeout> | null = null;

function checkAccountSoon() {
  if (accountTimer) clearTimeout(accountTimer);
  accountTimer = setTimeout(() => void checkAccount(), 800);
}

function openLogin(mode: "signin" | "signup") {
  showView("workspace");
  void workspace?.webContents.loadURL(`${WORKSPACE_URL}/login${mode === "signup" ? "?mode=signup" : ""}`);
}

// ------------------------------------------
// THE WORKSPACE VIEW
// ------------------------------------------

// Google refuses sign-in inside anything that calls
// itself Electron, so the workspace presents as the
// Chrome it is.
function chromeUserAgent(agent: string) {
  return agent.replace(/\sElectron\/\S+/, "").replace(/\sTeamski\/\S+/, "");
}

// Sign-in pages that open as popups and have to report
// back to the page that opened them - Google's button
// does this - so they open in the app, not the browser.
const SIGN_IN_HOSTS = [
  /(^|\.)accounts\.google\.com$/,
  /(^|\.)google\.com$/,
  /(^|\.)github\.com$/,
  /(^|\.)microsoftonline\.com$/,
  /(^|\.)live\.com$/,
  /(^|\.)supabase\.co$/,
];

function isSignInPopup(url: string) {
  if (url === "" || url === "about:blank") return true;

  try {
    const host = new URL(url).hostname;
    return host === new URL(WORKSPACE_URL).hostname || SIGN_IN_HOSTS.some((pattern) => pattern.test(host));
  } catch {
    return false;
  }
}

function isHttp(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function ensureWorkspace() {
  if (workspace || !win) return workspace;

  workspace = new WebContentsView({
    webPreferences: {
      partition: "persist:workspace",
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const contents = workspace.webContents;

  // For the page and any sign-in popup it opens.
  contents.session.setUserAgent(chromeUserAgent(contents.getUserAgent()));
  contents.setUserAgent(chromeUserAgent(contents.getUserAgent()));

  // Sign-in popups stay in the app, in the workspace's
  // own session, so they can hand the result back.
  // Other links that open a new tab go to the browser.
  contents.setWindowOpenHandler(({ url }) => {
    if (isSignInPopup(url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 520,
          height: 680,
          parent: win ?? undefined,
          autoHideMenuBar: true,
          backgroundColor: "#ffffff",
          webPreferences: {
            partition: "persist:workspace",
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        },
      };
    }

    if (isHttp(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  // Signing in or out shows up as navigation.
  contents.on("did-navigate", checkAccountSoon);
  contents.on("did-navigate-in-page", checkAccountSoon);
  contents.on("did-create-window", (child) => {
    child.on("closed", checkAccountSoon);
  });

  contents.session.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === "notifications" || permission === "clipboard-sanitized-write");
  });

  void contents.loadURL(WORKSPACE_URL);

  return workspace;
}

function layout() {
  if (!win || !workspace) return;

  const [width, height] = win.getContentSize();
  workspace.setBounds({ x: RAIL, y: 0, width: Math.max(0, width - RAIL), height });
}

function showView(view: "workspace" | "code") {
  if (!win) return;

  if (view === "workspace") {
    const wv = ensureWorkspace();
    if (wv && !win.contentView.children.includes(wv)) {
      win.contentView.addChildView(wv);
    }
    layout();
    wv?.webContents.focus();
  } else if (workspace && win.contentView.children.includes(workspace)) {
    win.contentView.removeChildView(workspace);
    win.webContents.focus();
  }

  win.webContents.send("view", view);
}

// ------------------------------------------
// THE WINDOW
// ------------------------------------------

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: "#0f0f0e",
    title: "Teamski",
    icon: path.join(__dirname, "icon.png"),
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  // The Code UI is a local page; it never navigates.
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttp(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  win.on("resize", layout);
  win.once("ready-to-show", () => win?.show());
  win.on("closed", () => {
    win = null;
    workspace = null;
  });

  void win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function buildMenu() {
  const mac = process.platform === "darwin";

  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open Folder…",
          accelerator: "CmdOrCtrl+O",
          click: () => {
            showView("code");
            win?.webContents.send("command", "open-folder");
          },
        },
        {
          label: "New Session",
          accelerator: "CmdOrCtrl+N",
          click: () => {
            showView("code");
            win?.webContents.send("command", "new-session");
          },
        },
        { type: "separator" },
        mac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "Workspace", accelerator: "CmdOrCtrl+1", click: () => showView("workspace") },
        { label: "Code", accelerator: "CmdOrCtrl+2", click: () => showView("code") },
        { type: "separator" },
        {
          label: "Reload Workspace",
          accelerator: "CmdOrCtrl+Shift+R",
          click: () => workspace?.webContents.reload(),
        },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(app.isPackaged ? [] : [{ role: "toggleDevTools" as const }]),
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "Teamski Website", click: () => void shell.openExternal("https://teamski.in") },
        { label: "Report a Problem", click: () => void shell.openExternal("https://github.com/janakrathi/Teamski/issues") },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ------------------------------------------
// THE BRIDGE
// ------------------------------------------
//
// Only the Code UI may call these. The check is on the
// sender, not on anything the caller says about itself.

function handle<A extends unknown[], R>(
  channel: string,
  fn: (...args: A) => R | Promise<R>
) {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!win || event.sender !== win.webContents) {
      throw new Error("Not allowed.");
    }

    return fn(...(args as A));
  });
}

const PROVIDER_IDS = new Set(["anthropic", "openai", "google", "groq", "cerebras", "openrouter", "deepseek", "mistral", "xai", "ollama", "custom"]);

function asProvider(value: unknown): ProviderId {
  if (typeof value !== "string" || !PROVIDER_IDS.has(value)) {
    throw new Error("Unknown provider.");
  }
  return value as ProviderId;
}

function registerBridge() {
  handle("state", () => state());

  handle("settings", (patch: Partial<Settings>) => {
    const allowed: Partial<Settings> = {};
    if (typeof patch?.model === "string") allowed.model = patch.model;
    if (patch?.mode === "ask" || patch?.mode === "auto-edit" || patch?.mode === "full-auto") allowed.mode = patch.mode;
    if (typeof patch?.showThinking === "boolean") allowed.showThinking = patch.showThinking;
    if (typeof patch?.sandbox === "boolean") allowed.sandbox = patch.sandbox;
    store.updateSettings(allowed);
    return state();
  });

  handle("key", (provider: unknown, key: unknown) => {
    store.setKey(asProvider(provider), typeof key === "string" && key.trim() ? key : null);
    return state();
  });

  handle("base-url", (provider: unknown, url: unknown) => {
    const id = asProvider(provider);
    if (!presetFor(id)?.editableUrl) throw new Error("That provider's address is fixed.");
    if (typeof url !== "string" || (url && !isHttp(url))) throw new Error("Give an http(s) address.");
    store.setBaseUrl(id, url);
    return state();
  });

  handle("models", async (provider: unknown) => {
    const id = asProvider(provider);
    const preset = presetFor(id)!;

    try {
      const models = await listModels({
        provider: id,
        kind: preset.kind,
        baseUrl: store.baseUrlFor(id),
        key: store.getKey(id),
      });

      return { models: models.length ? models : preset.suggested };
    } catch (error) {
      return { models: preset.suggested, error: (error as Error).message };
    }
  });

  handle("pick-folder", async () => {
    if (!win) return null;

    const result = await dialog.showOpenDialog(win, {
      title: "Open a project folder",
      properties: ["openDirectory", "createDirectory"],
    });

    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  handle("login", (mode: unknown) => {
    openLogin(mode === "signup" ? "signup" : "signin");
  });

  handle("install-update", () => installUpdate());

  handle("check-account", async () => {
    await checkAccount();
    return state();
  });

  handle("new-session", (folder: unknown) => {
    if (!account) throw new Error("Sign in to Teamski first.");
    if (typeof folder !== "string" || !folder) throw new Error("Pick a folder.");

    try {
      if (!statSync(folder).isDirectory()) throw new Error();
    } catch {
      throw new Error("That folder doesn't exist any more.");
    }

    store.rememberFolder(folder);
    const session = makeSession(newSessionData(folder, store.getSettings().model));
    return session.view();
  });

  handle("open-session", (id: unknown) => {
    if (typeof id !== "string") return null;
    return getSession(id)?.view() ?? null;
  });

  handle("delete-session", (id: unknown) => {
    if (typeof id === "string") {
      sessions.get(id)?.dispose();
      sessions.delete(id);
      store.deleteSession(id);
    }
    return state();
  });

  handle("send", (id: unknown, text: unknown) => {
    if (typeof id !== "string" || typeof text !== "string") return;
    const session = getSession(id);
    if (!session) throw new Error("That session is gone.");
    void session.send(text);
  });

  handle("stop", (id: unknown) => {
    if (typeof id === "string") sessions.get(id)?.stop();
  });

  handle("session-model", (id: unknown, model: unknown) => {
    if (typeof id !== "string" || typeof model !== "string") return;
    getSession(id)?.setModel(model);
    store.updateSettings({ model });
  });

  handle("respond", (id: unknown, requestId: unknown, decision: ApprovalDecision) => {
    if (typeof id !== "string" || typeof requestId !== "string") return;
    if (!decision || !["allow", "allow-session", "deny"].includes(decision.kind)) return;
    sessions.get(id)?.respond(requestId, decision);
  });

  handle("rewind", async (id: unknown, itemIndex: unknown) => {
    if (typeof id !== "string" || typeof itemIndex !== "number") return null;
    const session = getSession(id);
    if (!session) return null;
    const result = await session.rewind(itemIndex);
    return result ? { ...result, view: session.view() } : null;
  });

  handle("open-config", (which: unknown) => {
    if (which !== "mcp" && which !== "hooks") return;
    const file = store.configFile(which, which === "mcp" ? MCP_TEMPLATE : HOOKS_TEMPLATE);
    void shell.openPath(file);
  });

  handle("reload-mcp", async () => {
    await mcp().reload();
    return state();
  });

  handle("show-view", (view: unknown) => {
    if (view === "workspace" || view === "code") showView(view);
  });

  handle("open-external", (url: unknown) => {
    if (typeof url === "string" && isHttp(url)) void shell.openExternal(url);
  });

  handle("reveal-folder", (folder: unknown) => {
    if (typeof folder === "string") void shell.openPath(folder);
  });
}

// ------------------------------------------
// START
// ------------------------------------------

// A development run keeps its own settings, keys and
// sessions, apart from the installed app's.
if (!app.isPackaged) {
  app.setPath("userData", `${app.getPath("userData")}-dev`);
}

// Electron doesn't implement Chrome's FedCM sign-in API,
// and Google's button tries it first. Without it, Google
// uses its popup, which the app handles.
app.commandLine.appendSwitch("disable-features", "FedCm");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  // Nothing but our own windows may open windows.
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });

  void app.whenReady().then(() => {
    adoptLoginPath();
    registerBridge();
    buildMenu();
    createWindow();

    // Start MCP servers and check the sandbox in the
    // background; the window shows their state when ready.
    void sandboxStatus().then((status) => {
      sandboxInfo = { strong: status.strong, detail: status.detail };
      pushState();
    });

    void mcp()
      .ensure()
      .then(pushState);

    // Load the workspace in the background, so its
    // sign-in is known before anyone opens that tab.
    ensureWorkspace();
    void checkAccount();

    // Look for a newer version now and every six hours.
    setTimeout(() => void lookForUpdate(), 5000);
    setInterval(() => void lookForUpdate(), 6 * 60 * 60 * 1000);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("before-quit", () => {
    for (const session of sessions.values()) session.dispose();
    void hub?.close();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

