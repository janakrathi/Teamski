import type { DesktopApi } from "../shared/types.ts";

export type Bridge = DesktopApi & {
  onView(callback: (view: "workspace" | "code") => void): () => void;
  onCommand(callback: (command: string) => void): () => void;
};

declare global {
  interface Window {
    teamski: Bridge;
  }
}

export const api = (): Bridge => window.teamski;

export function basename(folder: string) {
  const parts = folder.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? folder;
}

export function timeAgo(at: number) {
  const seconds = Math.round((Date.now() - at) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(at).toLocaleDateString();
}

// "groq::openai/gpt-oss-120b" -> "openai/gpt-oss-120b"
export function modelLabel(value: string) {
  const at = value.indexOf("::");
  return at === -1 ? value || "No model" : value.slice(at + 2);
}

export function providerOf(value: string) {
  const at = value.indexOf("::");
  return at === -1 ? "" : value.slice(0, at);
}

export function formatTokens(n: number) {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
