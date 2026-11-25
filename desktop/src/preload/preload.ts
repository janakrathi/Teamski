import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import type { DesktopApi } from "../shared/types.ts";

// The Code UI's only way to reach the agent. Each
// call is a named request the main process checks;
// nothing of Node or Electron itself is handed over.

function listen<T>(channel: string, callback: (value: T) => void) {
  const handler = (_event: IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: DesktopApi & {
  onView(callback: (view: "workspace" | "code") => void): () => void;
  onCommand(callback: (command: string) => void): () => void;
} = {
  getState: () => ipcRenderer.invoke("state"),
  setSettings: (patch) => ipcRenderer.invoke("settings", patch),
  setKey: (provider, key) => ipcRenderer.invoke("key", provider, key),
  setBaseUrl: (provider, url) => ipcRenderer.invoke("base-url", provider, url),
  listModels: (provider) => ipcRenderer.invoke("models", provider),
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  newSession: (folder) => ipcRenderer.invoke("new-session", folder),
  openSession: (id) => ipcRenderer.invoke("open-session", id),
  deleteSession: (id) => ipcRenderer.invoke("delete-session", id),
  send: (id, text) => ipcRenderer.invoke("send", id, text),
  stop: (id) => ipcRenderer.invoke("stop", id),
  setSessionModel: (id, model) => ipcRenderer.invoke("session-model", id, model),
  respond: (id, requestId, decision) => ipcRenderer.invoke("respond", id, requestId, decision),
  showView: (view) => ipcRenderer.invoke("show-view", view),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  revealFolder: (folder) => ipcRenderer.invoke("reveal-folder", folder),
  onSession: (callback) => listen("session", callback),
  onState: (callback) => listen("state", callback),
  onView: (callback) => listen("view", callback),
  onCommand: (callback) => listen("command", callback),
};

contextBridge.exposeInMainWorld("teamski", api);
