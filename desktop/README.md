# Teamski desktop

Teamski for Windows and Mac. One window with two tabs:

- **Workspace**: teamski.in, in a locked-down view with no access to the computer.
- **Code**: Teamski Code, a coding agent that runs on this computer, in a folder you open. It reads, searches and edits files, runs commands (tests, builds, git, dev servers), fetches docs and keeps a task list. Edits and commands are approved according to the mode you pick: ask, auto-edit or full auto. Risky commands always ask.

Models are the person's own: API keys (Groq, Gemini, Cerebras, Mistral, Claude, OpenAI, DeepSeek, xAI, OpenRouter, or any OpenAI-compatible server) or Ollama on the same computer. Keys are encrypted with the OS keychain (`safeStorage`) and sent only to their provider. Code never passes through Teamski's servers.

## Develop

```bash
cd desktop
npm install
npm start          # build and launch
npm test           # agent, tools and safety tests
npm run typecheck
```

`TEAMSKI_URL=http://localhost:3000 npm start` points the Workspace tab at a local site.

## Layout

| Path | What |
| --- | --- |
| `src/main/main.ts` | Window, workspace view, menus, the IPC bridge |
| `src/main/agent.ts` | A coding session: the model/tool loop, approvals, context trimming |
| `src/main/tools.ts` | The tools. Each one plans (validates, builds the diff) before it applies |
| `src/main/models.ts` | Streaming for OpenAI-compatible APIs, Anthropic and Ollama, with tool calls |
| `src/main/files.ts`, `shell.ts`, `diff.ts` | Path safety, glob/grep, commands and background processes, diffs |
| `src/main/prompt.ts` | The system prompt: environment, git state, AGENTS.md/CLAUDE.md |
| `src/main/store.ts` | Settings, encrypted keys, saved sessions |
| `src/preload/preload.ts` | The narrow bridge the Code UI gets (`window.teamski`) |
| `src/renderer/` | The Code UI (React) |

## Release

Push a tag `desktop-vX.Y.Z` (matching `version` in `package.json`). `.github/workflows/desktop.yml` builds `Teamski-Setup.exe` and the two Mac `.dmg`s, then publishes a GitHub release. teamski.in/download links to the latest one.

The builds are unsigned for now. To sign them later, add an Apple Developer identity (`CSC_LINK`/`CSC_KEY_PASSWORD` plus notarization) and a Windows certificate as repository secrets. No code changes are needed.
