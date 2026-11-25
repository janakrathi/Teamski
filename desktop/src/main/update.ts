import { spawn } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { UpdateInfo } from "../shared/types.ts";

// ==========================================
// UPDATES
// ==========================================
//
// New versions are GitHub releases tagged desktop-vX.Y.Z
// (.github/workflows/desktop.yml). The app asks GitHub
// for the newest one; if it is newer than this copy,
// the window shows an Update button.
//
// Windows: the new installer is downloaded here, checked
// against the size GitHub lists, run silently, and it
// reopens Teamski. Mac: an unsigned app can't replace
// itself, so the button opens the download.
//

const REPO = "janakrathi/Teamski";

export function newer(candidate: string, current: string) {
  const parse = (v: string) => v.replace(/^v/, "").split(/[.-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);
  const a = parse(candidate);
  const b = parse(current);

  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }

  return false;
}

type Release = {
  tag_name: string;
  html_url: string;
  body?: string;
  draft: boolean;
  prerelease: boolean;
  assets: { name: string; size: number; browser_download_url: string }[];
};

function assetName() {
  if (process.platform === "win32") return "Teamski-Setup.exe";
  return process.arch === "arm64" ? "Teamski-mac-arm64.dmg" : "Teamski-mac-x64.dmg";
}

export async function checkForUpdate(current: string): Promise<UpdateInfo | null> {
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=15`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "Teamski-desktop" },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) return null;

  const releases = (await response.json()) as Release[];

  const latest = releases.find(
    (release) => !release.draft && !release.prerelease && release.tag_name.startsWith("desktop-v")
  );

  if (!latest) return null;

  const version = latest.tag_name.replace(/^desktop-v/, "");
  if (!newer(version, current)) return null;

  const asset = latest.assets.find((item) => item.name === assetName());

  return {
    version,
    notesUrl: latest.html_url,
    downloadUrl: asset?.browser_download_url ?? latest.html_url,
    size: asset?.size ?? 0,
    canInstall: process.platform === "win32" && Boolean(asset),
  };
}

// Download the installer, reporting progress 0..1.
export async function downloadInstaller(update: UpdateInfo, onProgress: (fraction: number) => void) {
  const response = await fetch(update.downloadUrl, {
    headers: { "User-Agent": "Teamski-desktop" },
    redirect: "follow",
  });

  if (!response.ok || !response.body) {
    throw new Error(`The download failed (${response.status}).`);
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "teamski-update-"));
  const file = path.join(dir, `Teamski-Setup-${update.version}.exe`);
  const out = createWriteStream(file);
  const total = update.size || Number(response.headers.get("content-length")) || 0;

  let received = 0;
  const reader = response.body.getReader();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value.length;
      if (!out.write(value)) await new Promise<void>((resolve) => out.once("drain", () => resolve()));
      if (total) onProgress(Math.min(1, received / total));
    }
  } finally {
    await new Promise<void>((resolve) => out.end(() => resolve()));
  }

  if (update.size && received !== update.size) {
    await fs.rm(dir, { recursive: true, force: true });
    throw new Error("The download was incomplete. Try again.");
  }

  return file;
}

// Run the installer on its own, after this app quits: it
// installs over this copy and starts the new one.
export function runInstaller(file: string) {
  const child = spawn(file, ["/S", "--force-run"], { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
}
