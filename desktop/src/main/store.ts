import { app, safeStorage } from "electron";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ProviderId, ProviderInfo, SessionSummary, Settings } from "../shared/types.ts";
import type { SessionData } from "./agent.ts";
import { PROVIDERS, joinModel, presetFor } from "./providers.ts";

// ==========================================
// WHAT THE APP REMEMBERS
// ==========================================
//
// Settings and sessions are JSON files in the app's
// data folder. API keys are encrypted with the OS
// keychain (safeStorage: Keychain on a Mac, DPAPI on
// Windows) and never leave this computer except to
// the provider they belong to.
//

type Stored = {
  settings: Settings;
  // provider -> encrypted key, base64
  keys: Partial<Record<ProviderId, string>>;
  // provider -> address, for the editable ones
  baseUrls: Partial<Record<ProviderId, string>>;
};

const DEFAULTS: Settings = {
  model: "",
  mode: "ask",
  recentFolders: [],
  showThinking: false,
};

function dataDir() {
  return app.getPath("userData");
}

function settingsFile() {
  return path.join(dataDir(), "settings.json");
}

function sessionsDir() {
  const dir = path.join(dataDir(), "sessions");
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Write to a temp file, then rename: a crash mid-write
// never leaves half a file.
function writeAtomic(file: string, content: string) {
  const temp = `${file}.tmp`;
  writeFileSync(temp, content, "utf8");
  renameSync(temp, file);
}

let stored: Stored | null = null;

function load(): Stored {
  if (stored) return stored;

  try {
    const parsed = JSON.parse(readFileSync(settingsFile(), "utf8")) as Partial<Stored>;
    stored = {
      settings: { ...DEFAULTS, ...(parsed.settings ?? {}) },
      keys: parsed.keys ?? {},
      baseUrls: parsed.baseUrls ?? {},
    };
  } catch {
    stored = { settings: { ...DEFAULTS }, keys: {}, baseUrls: {} };
  }

  return stored;
}

function persist() {
  mkdirSync(dataDir(), { recursive: true });
  writeAtomic(settingsFile(), JSON.stringify(load(), null, 2));
}

export function getSettings(): Settings {
  return load().settings;
}

export function updateSettings(patch: Partial<Settings>) {
  const current = load();
  current.settings = { ...current.settings, ...patch };
  persist();
  return current.settings;
}

export function rememberFolder(folder: string) {
  const current = load().settings.recentFolders.filter((entry) => entry !== folder);
  updateSettings({ recentFolders: [folder, ...current].slice(0, 12) });
}

// ------------------------------------------
// KEYS
// ------------------------------------------

export function setKey(provider: ProviderId, key: string | null) {
  const current = load();

  if (!key) {
    delete current.keys[provider];
  } else {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("This computer's keychain isn't available, so the key can't be stored safely.");
    }

    current.keys[provider] = safeStorage.encryptString(key.trim()).toString("base64");
  }

  persist();

  // The first key someone adds becomes their model.
  if (key && !current.settings.model) {
    const preset = presetFor(provider);
    const first = preset?.recommended ?? preset?.suggested[0];
    if (first) updateSettings({ model: joinModel(provider, first) });
  }
}

export function getKey(provider: ProviderId): string | undefined {
  const sealed = load().keys[provider];
  if (!sealed) return undefined;

  try {
    return safeStorage.decryptString(Buffer.from(sealed, "base64"));
  } catch {
    return undefined;
  }
}

export function setBaseUrl(provider: ProviderId, url: string) {
  const current = load();
  const cleaned = url.trim().replace(/\/+$/, "");

  if (cleaned) current.baseUrls[provider] = cleaned;
  else delete current.baseUrls[provider];

  persist();
}

export function baseUrlFor(provider: ProviderId) {
  return load().baseUrls[provider] || presetFor(provider)?.baseUrl || "";
}

export function providerInfo(): ProviderInfo[] {
  const current = load();

  return PROVIDERS.map((preset) => ({
    id: preset.id,
    label: preset.label,
    kind: preset.kind,
    needsKey: preset.needsKey,
    hasKey: Boolean(current.keys[preset.id]),
    keyUrl: preset.keyUrl,
    note: preset.note,
    free: preset.free,
    baseUrl: baseUrlFor(preset.id),
    editableUrl: preset.editableUrl,
  }));
}

// ------------------------------------------
// SESSIONS
// ------------------------------------------

const SAFE_ID = /^s_[a-z0-9_]+$/;

export function saveSession(data: SessionData) {
  if (!SAFE_ID.test(data.id)) return;
  writeAtomic(path.join(sessionsDir(), `${data.id}.json`), JSON.stringify(data));
}

export function loadSession(id: string): SessionData | null {
  if (!SAFE_ID.test(id)) return null;

  try {
    return JSON.parse(readFileSync(path.join(sessionsDir(), `${id}.json`), "utf8")) as SessionData;
  } catch {
    return null;
  }
}

export function deleteSession(id: string) {
  if (!SAFE_ID.test(id)) return;
  rmSync(path.join(sessionsDir(), `${id}.json`), { force: true });
}

export function listSessions(): SessionSummary[] {
  const summaries: SessionSummary[] = [];

  for (const name of readdirSync(sessionsDir())) {
    if (!name.endsWith(".json")) continue;

    try {
      const data = JSON.parse(readFileSync(path.join(sessionsDir(), name), "utf8")) as SessionData;
      if (!data.messages?.length) continue;
      summaries.push({ id: data.id, title: data.title, folder: data.folder, updatedAt: data.updatedAt });
    } catch {
      // A damaged file - skip it.
    }
  }

  return summaries.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 200);
}
