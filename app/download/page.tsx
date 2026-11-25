import type { Metadata } from "next";

import { H2, LegalPage, List } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Download Teamski for Windows and Mac",
  description:
    "Teamski for Windows and Mac: your team's AI workspace, plus Teamski Code - a coding agent that reads, edits and tests code in your own folders, on your own keys or local models.",
  alternates: { canonical: "/download" },
};


// The installers are built by GitHub Actions
// (.github/workflows/desktop.yml) and published as a
// release with fixed file names, so "latest/download"
// always points at the newest build.

const RELEASES = "https://github.com/janakrathi/Teamski/releases/latest";

const DOWNLOADS = [
  { label: "Windows", sub: "Windows 10 and 11, 64-bit", file: "Teamski-Setup.exe" },
  { label: "Mac - Apple Silicon", sub: "M1 and later", file: "Teamski-mac-arm64.dmg" },
  { label: "Mac - Intel", sub: "Older Macs", file: "Teamski-mac-x64.dmg" },
];

const buttonClass =
  "flex flex-col rounded-xl border border-white/15 bg-white/[0.04] px-5 py-4 no-underline transition hover:border-white/30 hover:bg-white/[0.07]";


export default function DownloadPage() {
  return (
    <LegalPage title="Teamski for desktop">
      <p>
        Your team&apos;s workspace and a coding agent in one app. The
        Workspace tab is Teamski as you know it. The Code tab is new: open
        a folder and Teamski Code reads your code, makes changes, runs your
        tests and commands, and asks before anything risky - like Claude
        Code or Codex, on the model you choose.
      </p>

      <div className="grid gap-3 pt-4 sm:grid-cols-3">
        {DOWNLOADS.map((download) => (
          <a
            key={download.file}
            href={`${RELEASES}/download/${download.file}`}
            className={buttonClass}
          >
            <span className="text-[15px] font-medium text-[var(--text)]">
              {download.label}
            </span>
            <span className="text-[12.5px] text-white/45">{download.sub}</span>
          </a>
        ))}
      </div>

      <p className="text-[13px]">
        All builds and release notes are on{" "}
        <a href={RELEASES} className="text-[var(--text)] underline underline-offset-2">
          GitHub
        </a>
        .
      </p>


      <H2>First launch (beta)</H2>

      <p>
        The app isn&apos;t code-signed yet, so your computer will be
        cautious the first time:
      </p>

      <List>
        <li>
          <strong>Windows:</strong> if SmartScreen says it protected your
          PC, click <em>More info</em>, then <em>Run anyway</em>.
        </li>
        <li>
          <strong>Mac:</strong> drag Teamski to Applications, then run{" "}
          <code>xattr -cr /Applications/Teamski.app</code> in Terminal once
          and open it normally.
        </li>
      </List>


      <H2>Which models does Teamski Code use?</H2>

      <List>
        <li>
          <strong>Your own free key:</strong> Groq (GPT-OSS 120B), Google
          Gemini, Cerebras or Mistral - each takes about two minutes and
          no card.
        </li>
        <li>
          <strong>Your own paid key:</strong> Claude, OpenAI, DeepSeek,
          xAI or OpenRouter.
        </li>
        <li>
          <strong>Your own computer:</strong> any model in Ollama, such as
          Qwen3-Coder - fully private, if you have the GPU for it.
        </li>
      </List>

      <p>
        Keys are stored encrypted in your computer&apos;s keychain and are
        sent only to the provider they belong to. Your code goes from your
        computer to the model you picked - never through Teamski&apos;s
        servers.
      </p>


      <H2>What can it do?</H2>

      <List>
        <li>Find its way around a codebase with file search and code search</li>
        <li>Edit files, with a diff you approve before anything changes</li>
        <li>Run tests, builds, linters, git and dev servers in the background</li>
        <li>Search the web and read documentation</li>
        <li>Keep a visible task list for longer jobs</li>
        <li>Follow your repo&apos;s AGENTS.md or CLAUDE.md</li>
        <li>
          Three modes: ask before every change, auto-edit, or full auto -
          risky commands like <code>git push</code> always ask
        </li>
      </List>


      <H2>New in 0.2</H2>

      <List>
        <li>
          <strong>Command sandbox:</strong> commands run without internet
          access unless you approve one that needs it. On a Mac the system
          enforces it - writes stay inside your project and files like
          <code>~/.ssh</code> can&apos;t be read. On Windows it&apos;s best
          effort.
        </li>
        <li>
          <strong>Undo any message:</strong> the files the agent changed since
          then go back the way they were.
        </li>
        <li>
          <strong>Longer tasks:</strong> older conversation is summarised when
          it gets long, and helper agents research in parallel.
        </li>
        <li>
          <strong>MCP servers and hooks</strong> in the same format as Claude
          Code, so your existing setup works.
        </li>
        <li>
          <strong>Updates:</strong> the app tells you when a new version is
          ready and, on Windows, installs it for you.
        </li>
      </List>

      <p>
        Already installed 0.1? Download it once more and run the installer -
        your keys and sessions stay. From 0.2 on, the app updates itself.
      </p>
    </LegalPage>
  );
}
