# Teamski

**Shared AI agents for teams.** Every channel has its
own agent that the whole team talks to. It remembers
the project, uses your connected apps, runs tasks in
the background and asks before changing anything.

Hosted at **[teamski.in](https://teamski.in)**. The
free plan includes a built-in AI, so there's nothing
to set up. This repository is the whole app, and you
can run it yourself.

## What it does

- **Projects → channels → messages**, plus direct
  messages, threads, mentions, attachments, unread
  counts and search.
- **An agent per channel** with its own instructions,
  model and memory, or a ready-made one (Research,
  Planner, Writer, Code review, Meeting notes, and
  more).
- **Multiplayer by design.** Everyone in a channel
  talks to the same agent. When teammates contradict
  each other, it names the conflict and asks the team
  which to follow.
- **Memory.** A token-budgeted window of recent turns,
  a rolling summary and durable facts, found by
  meaning (pgvector). Each channel has its own memory
  plus one shared project memory for the brief and
  team decisions. Memory is encrypted at rest.
- **Background tasks.** Queued runs are advanced by a
  separate worker, with real pause and stop. They
  keep going if you close the tab.
- **Tools and connected apps.** Files, web search and
  page reading, image generation, Google Sheets,
  GitHub, and any remote MCP server (Notion, Linear,
  Jira, Asana, Canva, Sentry, Stripe, Hugging Face).
  Anything that changes a connected app, or deletes a
  file, waits for a person to approve it.
- **Any model.** Built-in shared models (GPT-OSS 120B
  on Groq or Cerebras, or a local model through
  Ollama), or a team's own Claude, ChatGPT, Gemini,
  Grok or other key, with monthly caps and a spend
  report.
- **Plans and billing** (Free and Team, per project,
  through Razorpay), roles (owner, admin, member), a
  usage dashboard, error alerts and per-person rate
  limits.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript ·
Supabase (Postgres, row level security, pgvector,
Realtime, Storage, Auth) · a Node worker for
background runs · Tailwind CSS · Resend · Razorpay.

## Run it yourself

```bash
git clone <this repo> teamski && cd teamski
npm install
cp .env.example .env.local   # then fill in the required block
npm run dev                  # the app, on localhost:3000
npm run worker               # background tasks, in a second terminal
```

You also need a Supabase project with the database
set up. **[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)**
walks through all of it: Supabase, models, sign-in,
connections, email, payments and running in
production.

```bash
npm test
```

## How it fits together

```
app/api/chat           streaming chat: model, tools, memory, retries
app/api/...            one route per resource, each checking membership
worker/index.mts       claims background runs, advances them, honours pause
lib/ai/providers       which model, whose key, fallbacks, the call itself
lib/ai/memory.ts       window + summary + facts, channel and project scope
lib/ai/tools.ts        tool registry: schema + implementation + approval
lib/ai/web.ts          search and page reading, with the SSRF guard
lib/mcp                connected apps over MCP, with OAuth
lib/crypto/secrets.ts  AES-256-GCM sealing for keys, tokens and memory
lib/plans.ts           what each plan includes, and the checks
supabase/migrations    the schema and RLS policies; ALL.sql is all of it
```

Realtime is Supabase Realtime: messages are written
to Postgres first, and clients subscribed to their
project are told to refetch through the API, so
access control lives in one place. AI replies stream
over HTTP to whoever asked.

## Security

API keys, OAuth tokens, MCP sign-ins and AI memory
are encrypted before they are stored. Every table
has row level security. URLs a model chooses are
checked, including where they resolve to and every
redirect, before any request is made. More detail
at [teamski.in/security](https://teamski.in/security).

Found a vulnerability? Please email
**support@teamski.in** rather than opening a public
issue.

## Licence

[GNU AGPL-3.0](LICENSE). You can use, change and
self-host Teamski freely. If you run a modified
version as a service for other people, you must
publish your changes under the same licence.
