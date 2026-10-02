# Self-hosting Teamski

What you need: Node.js 22.18 or newer (24 is what
production runs), a free [Supabase](https://supabase.com)
project, and at least one AI model. That can be a
free Groq key, or Ollama on your own machine.

Teamski is two processes: the **Next.js app** and the
**worker** that advances background tasks. Both read
`.env.local`.


## 1. Install

```bash
npm install
cp .env.example .env.local
```

## 2. Supabase

1. Create a project.
2. In **Project Settings → API**, copy the URL, the
   publishable key and the service role key into the
   required block of `.env.local`.
3. Open the **SQL editor**, paste
   `supabase/migrations/ALL.sql` and run it. It is
   every migration in order and safe to re-run. It
   creates the tables, row level security, the
   pgvector extension, the `attachments` storage
   bucket and the Realtime publication.
4. In **Authentication → URL Configuration**, set the
   Site URL to your address and add
   `<your address>/auth/callback` to the redirect
   URLs (plus `http://localhost:3000/auth/callback`
   for development).
5. Optional: under **Authentication → Providers**,
   turn on Google or GitHub sign-in.

Upgrading later: `supabase/migrations/PENDING.sql`
holds the newest migrations. The numbered files are
the same SQL, one change each.

> If a migration ran but the app still says a table
> is missing, PostgREST is caching an old schema. Run
> `notify pgrst, 'reload schema';`.

## 3. The secret key

```bash
openssl rand -base64 32
```

Put the output in `TEAMSKI_SECRET_KEY`. It encrypts
API keys, OAuth tokens, MCP sign-ins and AI memory
(AES-256-GCM, `lib/crypto/secrets.ts`). In production
nothing secret is stored without it.

**Back it up somewhere other than the server, and
never change it.** If you lose it, every stored key
and connection has to be re-entered and the agents
forget everything. If values were saved before the
key was set, encrypt them with:

```bash
npm run seal-secrets -- --write
npm run seal-memory -- --write
```

(Without `--write` they only count.)

## 4. Self-hosted mode

`.env.example` sets `NEXT_PUBLIC_SELF_HOSTED=true`,
and the Docker image defaults to it. With it on:

- **Every project gets every feature:** connected
  apps, your own and shared API keys, the spend
  report, and Team's scheduled agents. There's no
  trial and nothing to buy.
- **No plan, billing or upgrade screens.** Checkout,
  the Razorpay webhook and the contact-sales form
  are switched off.
- **No billing reminders or win-back emails** from
  the worker. Those are teamski.in's own.
- **Signed-out visitors go straight to sign-in**
  instead of the teamski.in landing page.
- **No daily cap on built-in AI messages,** since
  you pay for the AI. Set `DAILY_MESSAGE_LIMIT` to
  cap messages per person per day, and
  `SCHEDULES_PER_PROJECT` to change the number of
  scheduled agents.

Roles still apply: owners and admins manage
settings, members use the project.

It's read when the app is built, so rebuild after
changing it.

## 5. A model

Pick at least one.

**Groq or Cerebras (simplest).** Put a free key from
[console.groq.com](https://console.groq.com/keys) in
`GROQ_API_KEY` (or `CEREBRAS_API_KEY`). GPT-OSS 120B
becomes the default for everyone, rationed by each
plan's daily message allowance (`lib/plans.ts`).
Free tiers have per-minute token limits; when one is
hit, chat falls back to the next model available.

**Ollama (fully local).**

```bash
ollama serve
ollama pull qwen3:1.7b
ollama pull nomic-embed-text
```

`nomic-embed-text` powers memory search by meaning.
Without it, memory falls back to recency.

Separately, users can always add their own Claude,
ChatGPT, Gemini, Grok or other keys in Settings.

## 6. Run

### With Docker

```bash
docker compose --env-file .env.local up -d --build
```

This builds one image and runs it twice: as the web
app on port 3000 and as the worker. Files the agents
write are kept in a Docker volume. `NEXT_PUBLIC_*`
values are baked in at build time, which is why
`--env-file .env.local` is passed to compose as well.

To also run Ollama, set
`OLLAMA_HOST=http://ollama:11434` in `.env.local`,
then:

```bash
docker compose --env-file .env.local --profile ollama up -d --build
docker compose exec ollama ollama pull qwen3:1.7b
docker compose exec ollama ollama pull nomic-embed-text
```

Update with `git pull` and the same `up -d --build`.

### Without Docker

Development:

```bash
npm run dev
npm run worker
```

Production:

```bash
npm run build && npm start
npm run worker
```

Use a process manager so both restart on crash and
on boot. For example, with pm2:

```bash
pm2 start npm --name web -- start
pm2 start npm --name worker -- run worker
pm2 save
```

Put a reverse proxy with HTTPS (nginx, Caddy,
Apache) in front of port 3000, and set
`NEXT_PUBLIC_SITE_URL` to the public address.
`NEXT_PUBLIC_*` values are read at build time, so
rebuild after changing them.

To deploy an update:

```bash
git pull && npm run build && pm2 restart web worker
```


## Optional features

Each one switches on when its variables in
`.env.example` are set.

| Feature | Variables | Notes |
| --- | --- | --- |
| Connect Google Sheets | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Callback: `<site>/api/connections/google` |
| Connect GitHub | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Callback: `<site>/api/connections/github`. GitHub allows one callback per app, so use separate apps for localhost and production. |
| Google's own sign-in button | `GOOGLE_SIGNIN_CLIENT_ID` | Defaults to `GOOGLE_CLIENT_ID`; list your site as an authorized JavaScript origin |
| Email (invites, reminders, alerts) | `RESEND_API_KEY`, `EMAIL_FROM` | Verify your domain in Resend first. Without email, invite links are shown to copy instead. |
| Image generation | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI |
| Better web search | `BRAVE_API_KEY` | Otherwise DuckDuckGo |
| Payments | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Webhook: `<site>/api/webhooks/razorpay`. Without payments, set a project's plan by hand in the `project_subscriptions` table. |
| Usage dashboard at `/admin` | `ADMIN_EMAILS` | Anyone else gets a 404 |
| Error alerts by email | `ALERT_EMAILS` (or `ADMIN_EMAILS`) | `npm run alert:test` sends one |
| Contact-sales form | `ENTERPRISE_SHEET_URL`, `ENTERPRISE_SHEET_SECRET`, `ENTERPRISE_NOTIFY_EMAILS` | Sheet side: `scripts/enterprise-sheet.gs` |
| Meta ads tracking | `NEXT_PUBLIC_META_PIXEL_ID`, `META_CAPI_TOKEN` | Off unless set |

The legal pages read their details (operator name,
site, courts) from `lib/legal.ts`. Change them to
your own before going live.


## Operations

**Rate limits.** Every API request is counted per
signed-in person (per IP when signed out), with
tighter limits on expensive actions. The table is
`RULES` in `lib/rate-limit.ts`. Counters live in
memory, which is right for one app process; run
several and each counts separately. Sign-in itself
is rate-limited by Supabase (Authentication → Rate
Limits).

**Error alerts.** In production, problems are
emailed: the AI or the database not answering, the
worker crashing or leaving tasks queued, server
errors, and failed chats or tasks. Each problem
sends at most one email every 30 minutes, and keys
are blanked out of the text.

**Backups.** Back up the Supabase database (daily
backups, or a scheduled `pg_dump`), the
`agent-files/` folder the agents write into, and
`.env.local`, especially `TEAMSKI_SECRET_KEY`.

**Web access guard.** `fetch_page` and MCP
connections refuse private and loopback addresses.
That covers the address as written, every address
the name resolves to, and every redirect, all
checked before a request is made. A page the agent
reads is returned fenced and labelled as something
to read, not obey.
