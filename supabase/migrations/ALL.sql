-- ==========================================
-- EVERY MIGRATION, IN ORDER
-- ==========================================
--
-- A fresh database, from nothing to current.
-- Safe to run more than once.
--

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 0001_channels.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- ==========================================
-- CHANNELS
-- ==========================================
--
-- Adds a channel layer between projects and
-- messages:
--
--   projects
--    └─ channels
--        └─ messages
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--

create extension if not exists "pgcrypto";


-- ------------------------------------------
-- TABLE
-- ------------------------------------------

create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id)
    on delete cascade,

  name text not null,

  created_by uuid
    references auth.users (id)
    on delete set null,

  created_at timestamptz not null default now(),

  unique (project_id, name)
);

create index if not exists channels_project_id_idx
  on public.channels (project_id);


-- ------------------------------------------
-- LINK MESSAGES TO CHANNELS
-- ------------------------------------------

alter table public.messages
  add column if not exists channel_id uuid
    references public.channels (id)
    on delete cascade;

create index if not exists messages_channel_id_idx
  on public.messages (channel_id);


-- ------------------------------------------
-- BACKFILL
-- ------------------------------------------
--
-- Every existing project gets a "general"
-- channel, and every message that predates
-- channels moves into its project's general.
-- Nothing is deleted.
--

insert into public.channels (project_id, name)
select p.id, 'general'
  from public.projects p
on conflict (project_id, name) do nothing;

update public.messages m
   set channel_id = c.id
  from public.channels c
 where c.project_id = m.project_id
   and c.name = 'general'
   and m.channel_id is null;


-- ------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------
--
-- A channel is visible to the members of its
-- project, matching how projects and messages
-- are already scoped.
--

alter table public.channels enable row level security;

drop policy if exists
  "Project members can read channels"
  on public.channels;

create policy "Project members can read channels"
  on public.channels
  for select
  using (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = channels.project_id
         and pm.user_id = auth.uid()
    )
  );

drop policy if exists
  "Project members can create channels"
  on public.channels;

create policy "Project members can create channels"
  on public.channels
  for insert
  with check (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = channels.project_id
         and pm.user_id = auth.uid()
    )
  );

drop policy if exists
  "Project members can rename channels"
  on public.channels;

create policy "Project members can rename channels"
  on public.channels
  for update
  using (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = channels.project_id
         and pm.user_id = auth.uid()
    )
  );

drop policy if exists
  "Project members can delete channels"
  on public.channels;

create policy "Project members can delete channels"
  on public.channels
  for delete
  using (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = channels.project_id
         and pm.user_id = auth.uid()
    )
  );


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 0002_memory.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- ==========================================
-- SHARED AGENT MEMORY
-- ==========================================
--
-- Moves what the agent remembers out of local
-- SQLite and into Supabase.
--
-- Memory used to live on whichever machine ran
-- the chat, so a teammate opening the same
-- project got an agent that remembered nothing.
-- In a shared workspace the memory has to be
-- shared too.
--
-- Scope is (project_id, channel_id). A null
-- channel_id is project-wide memory, which is
-- what conversations use before the channels
-- migration has been applied.
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--

create extension if not exists "pgcrypto";


-- ------------------------------------------
-- ROLLING SUMMARY
-- ------------------------------------------

create table if not exists public.conversation_summaries (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id)
    on delete cascade,

  channel_id uuid
    references public.channels (id)
    on delete cascade,

  summary text not null,

  covered_count integer not null default 0,

  updated_at timestamptz not null default now()
);

-- One summary per scope. Two partial indexes
-- rather than a plain unique constraint, because
-- Postgres treats nulls as distinct and would
-- happily store many project-wide rows.

create unique index if not exists conversation_summaries_channel_key
  on public.conversation_summaries (project_id, channel_id)
  where channel_id is not null;

create unique index if not exists conversation_summaries_project_key
  on public.conversation_summaries (project_id)
  where channel_id is null;


-- ------------------------------------------
-- DURABLE FACTS
-- ------------------------------------------

create table if not exists public.memory_facts (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id)
    on delete cascade,

  channel_id uuid
    references public.channels (id)
    on delete cascade,

  content text not null,

  source text not null default 'auto',

  created_by uuid
    references auth.users (id)
    on delete set null,

  created_at timestamptz not null default now()
);

create index if not exists memory_facts_scope_idx
  on public.memory_facts (project_id, channel_id);

-- Same idea: do not store the same fact twice
-- in one scope.

create unique index if not exists memory_facts_channel_key
  on public.memory_facts (project_id, channel_id, content)
  where channel_id is not null;

create unique index if not exists memory_facts_project_key
  on public.memory_facts (project_id, content)
  where channel_id is null;


-- ------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------
--
-- Memory is readable and writable by the members
-- of its project, matching channels and messages.
--

alter table public.conversation_summaries
  enable row level security;

alter table public.memory_facts
  enable row level security;


drop policy if exists
  "Project members manage summaries"
  on public.conversation_summaries;

create policy "Project members manage summaries"
  on public.conversation_summaries
  for all
  using (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = conversation_summaries.project_id
         and pm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = conversation_summaries.project_id
         and pm.user_id = auth.uid()
    )
  );


drop policy if exists
  "Project members manage facts"
  on public.memory_facts;

create policy "Project members manage facts"
  on public.memory_facts
  for all
  using (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = memory_facts.project_id
         and pm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = memory_facts.project_id
         and pm.user_id = auth.uid()
    )
  );


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 0003_usage.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- ==========================================
-- USAGE TRACKING
-- ==========================================
--
-- Every model call already reports how many
-- tokens it used and how long it took. That was
-- shown once under a message and then thrown
-- away, so nobody could answer "what is this
-- costing us" or "why is it slow today".
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--

create extension if not exists "pgcrypto";

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id)
    on delete cascade,

  channel_id uuid
    references public.channels (id)
    on delete cascade,

  user_id uuid
    references auth.users (id)
    on delete set null,

  model text not null,

  -- "chat" for a reply, "memory" for the
  -- background summary and fact extraction.
  kind text not null default 'chat',

  prompt_tokens integer not null default 0,
  response_tokens integer not null default 0,
  duration_ms integer not null default 0,

  -- How many tool calls the turn made.
  tool_calls integer not null default 0,

  created_at timestamptz not null default now()
);

create index if not exists usage_events_project_idx
  on public.usage_events (project_id, created_at desc);


alter table public.usage_events
  enable row level security;

drop policy if exists
  "Project members read usage"
  on public.usage_events;

create policy "Project members read usage"
  on public.usage_events
  for select
  using (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = usage_events.project_id
         and pm.user_id = auth.uid()
    )
  );

drop policy if exists
  "Project members write usage"
  on public.usage_events;

create policy "Project members write usage"
  on public.usage_events
  for insert
  with check (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = usage_events.project_id
         and pm.user_id = auth.uid()
    )
  );


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 0004_agent_runs.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- ==========================================
-- AGENT RUNS
-- ==========================================
--
-- Background agents used to be one blocking
-- Ollama call inside a request handler. There
-- was no loop to pause, nothing to resume, and
-- a refresh killed the work. The Pause and Stop
-- buttons wrote a status that nothing read.
--
-- A run is now a durable row that a separate
-- worker process picks up, advances one step at
-- a time, and checks for pause or stop between
-- every step.
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--

create extension if not exists "pgcrypto";

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),

  agent_id uuid not null
    references public.agents (id)
    on delete cascade,

  project_id uuid not null
    references public.projects (id)
    on delete cascade,

  channel_id uuid
    references public.channels (id)
    on delete set null,

  started_by uuid
    references auth.users (id)
    on delete set null,

  task text not null,

  -- queued   -> waiting for a worker
  -- running  -> a worker is advancing it
  -- paused   -> halted, context kept
  -- stopped  -> halted by a human
  -- done     -> finished on its own
  -- error    -> gave up
  status text not null default 'queued',

  -- The full message list, so a worker that
  -- picks the run up later knows everything that
  -- has happened so far.
  messages jsonb not null default '[]'::jsonb,

  step integer not null default 0,

  result text,
  error text,

  -- Set while a worker holds the run, so two
  -- workers cannot advance the same one.
  claimed_at timestamptz,
  claimed_by text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_runs_queue_idx
  on public.agent_runs (status, created_at);

create index if not exists agent_runs_agent_idx
  on public.agent_runs (agent_id, created_at desc);


-- ------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------
--
-- Members of the project can see and start runs.
-- The worker connects with the service role and
-- bypasses these entirely.
--

alter table public.agent_runs enable row level security;

drop policy if exists
  "Project members read runs"
  on public.agent_runs;

create policy "Project members read runs"
  on public.agent_runs
  for select
  using (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = agent_runs.project_id
         and pm.user_id = auth.uid()
    )
  );

drop policy if exists
  "Project members start runs"
  on public.agent_runs;

create policy "Project members start runs"
  on public.agent_runs
  for insert
  with check (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = agent_runs.project_id
         and pm.user_id = auth.uid()
    )
  );

drop policy if exists
  "Project members control runs"
  on public.agent_runs;

create policy "Project members control runs"
  on public.agent_runs
  for update
  using (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = agent_runs.project_id
         and pm.user_id = auth.uid()
    )
  );


-- ------------------------------------------
-- CLAIM ONE RUN
-- ------------------------------------------
--
-- Atomically hands a single queued run to one
-- worker. Without this two workers polling at
-- the same moment would both take it.
--

create or replace function public.claim_agent_run(
  worker_id text
)
returns setof public.agent_runs
language sql
volatile
security definer
set search_path = public
as $$
  update public.agent_runs
     set status = 'running',
         claimed_at = now(),
         claimed_by = worker_id,
         updated_at = now()
   where id = (
     select id
       from public.agent_runs
      where status = 'queued'
      order by created_at
      for update skip locked
      limit 1
   )
  returning *;
$$;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 0005_agent_activity.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- ==========================================
-- LIVE AGENT ACTIVITY
-- ==========================================
--
-- The worker already records every step it takes
-- into agent_events. This makes those rows
-- readable by the people in the project and
-- pushes them out over realtime, so a background
-- agent can be watched instead of only inspected
-- afterwards in the database.
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--


-- ------------------------------------------
-- TABLE PRIVILEGES
-- ------------------------------------------
--
-- Row level security decides which rows a role
-- may see, but it cannot grant access to the
-- table in the first place. Supabase normally
-- sets these defaults up; they are missing here,
-- which is why the service role could not read
-- its own tables until they were granted.
--
-- Granting is idempotent, so this is safe even
-- where the privileges already exist.
--

grant usage on schema public
  to anon, authenticated, service_role;

grant select, insert, update, delete
  on all tables in schema public
  to authenticated;

grant select
  on all tables in schema public
  to anon;

grant all privileges
  on all tables in schema public
  to service_role;

grant usage, select
  on all sequences in schema public
  to anon, authenticated, service_role;

-- Make sure tables added later inherit the same
-- privileges rather than repeating this.

alter default privileges in schema public
  grant select, insert, update, delete
  on tables to authenticated;

alter default privileges in schema public
  grant select on tables to anon;

alter default privileges in schema public
  grant all on tables to service_role;


-- ------------------------------------------
-- READ POLICIES FOR AGENT TABLES
-- ------------------------------------------
--
-- Anyone in the project can watch its agents.
-- Writing stays with the worker, which uses the
-- service role and bypasses these.
--

alter table public.agent_events
  enable row level security;

drop policy if exists
  "Project members read agent events"
  on public.agent_events;

create policy "Project members read agent events"
  on public.agent_events
  for select
  using (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = agent_events.project_id
         and pm.user_id = auth.uid()
    )
  );


alter table public.agents
  enable row level security;

drop policy if exists
  "Project members read agents"
  on public.agents;

create policy "Project members read agents"
  on public.agents
  for select
  using (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = agents.project_id
         and pm.user_id = auth.uid()
    )
  );

drop policy if exists
  "Project members update agents"
  on public.agents;

create policy "Project members update agents"
  on public.agents
  for update
  using (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = agents.project_id
         and pm.user_id = auth.uid()
    )
  );


-- ------------------------------------------
-- REALTIME
-- ------------------------------------------
--
-- A table only streams changes to the browser
-- once it is in this publication. Adding one
-- twice is an error, so check first.
--

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'agent_events'
  ) then
    alter publication supabase_realtime
      add table public.agent_events;
  end if;

  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'agent_runs'
  ) then
    alter publication supabase_realtime
      add table public.agent_runs;
  end if;
end
$$;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 0006_attachments.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- ==========================================
-- ATTACHMENTS
-- ==========================================
--
-- Lets people hand the agent a file instead of
-- only asking it to write one.
--
-- The file itself goes to Supabase Storage. The
-- text pulled out of it is stored here, so the
-- prompt does not have to re-parse a PDF on
-- every turn, and so search can reach inside
-- documents later.
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--

create extension if not exists "pgcrypto";


create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id)
    on delete cascade,

  channel_id uuid
    references public.channels (id)
    on delete set null,

  -- Set once the message it belongs to is sent.
  -- Null means uploaded but not yet posted.
  message_id uuid
    references public.messages (id)
    on delete cascade,

  uploaded_by uuid
    references auth.users (id)
    on delete set null,

  filename text not null,
  mime text not null default '',
  size_bytes integer not null default 0,

  -- Where the bytes live in the storage bucket.
  storage_path text not null,

  -- text | pdf | docx | image | other
  kind text not null default 'other',

  -- What the model gets to read. Null for images
  -- and anything unparseable.
  extracted_text text,

  -- True when the file held more text than we
  -- kept, so the UI can say so.
  truncated boolean not null default false,

  -- Why there is no text, in plain words.
  note text,

  created_at timestamptz not null default now()
);

create index if not exists attachments_message_idx
  on public.attachments (message_id);

create index if not exists attachments_project_idx
  on public.attachments (project_id, created_at desc);


alter table public.attachments
  enable row level security;

drop policy if exists
  "Project members read attachments"
  on public.attachments;

create policy "Project members read attachments"
  on public.attachments
  for select
  using (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = attachments.project_id
         and pm.user_id = auth.uid()
    )
  );

drop policy if exists
  "Project members add attachments"
  on public.attachments;

create policy "Project members add attachments"
  on public.attachments
  for insert
  with check (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = attachments.project_id
         and pm.user_id = auth.uid()
    )
  );

drop policy if exists
  "Project members update attachments"
  on public.attachments;

create policy "Project members update attachments"
  on public.attachments
  for update
  using (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = attachments.project_id
         and pm.user_id = auth.uid()
    )
  );

drop policy if exists
  "Project members delete attachments"
  on public.attachments;

create policy "Project members delete attachments"
  on public.attachments
  for delete
  using (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = attachments.project_id
         and pm.user_id = auth.uid()
    )
  );


-- ------------------------------------------
-- STORAGE
-- ------------------------------------------
--
-- Private bucket. Files are read through signed
-- URLs, so nothing is reachable without being in
-- the project.
--
-- Objects are keyed as <project_id>/<uuid>-<name>,
-- and the policies below read that first path
-- segment to decide who may touch them.
--

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;


drop policy if exists
  "Project members read attachment files"
  on storage.objects;

create policy "Project members read attachment files"
  on storage.objects
  for select
  using (
    bucket_id = 'attachments'
    and exists (
      select 1
        from public.project_members pm
       where pm.user_id = auth.uid()
         and pm.project_id::text =
             (storage.foldername(name))[1]
    )
  );

drop policy if exists
  "Project members upload attachment files"
  on storage.objects;

create policy "Project members upload attachment files"
  on storage.objects
  for insert
  with check (
    bucket_id = 'attachments'
    and exists (
      select 1
        from public.project_members pm
       where pm.user_id = auth.uid()
         and pm.project_id::text =
             (storage.foldername(name))[1]
    )
  );

drop policy if exists
  "Project members delete attachment files"
  on storage.objects;

create policy "Project members delete attachment files"
  on storage.objects
  for delete
  using (
    bucket_id = 'attachments'
    and exists (
      select 1
        from public.project_members pm
       where pm.user_id = auth.uid()
         and pm.project_id::text =
             (storage.foldername(name))[1]
    )
  );


-- Same privilege gap as the other tables: the
-- policies decide which rows, but the role still
-- needs the table itself.

grant select, insert, update, delete
  on public.attachments to authenticated;

grant all privileges
  on public.attachments to service_role;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 0007_notifications.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- ==========================================
-- NOTIFICATIONS
-- ==========================================
--
-- The workspace is shared but silent: nothing
-- tells you a teammate wrote to you, mentioned
-- you, or that an agent you started has
-- finished. This is the table that says so.
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--

create extension if not exists "pgcrypto";


create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),

  -- Who should see it.
  user_id uuid not null
    references auth.users (id)
    on delete cascade,

  project_id uuid
    references public.projects (id)
    on delete cascade,

  channel_id uuid
    references public.channels (id)
    on delete cascade,

  message_id uuid
    references public.messages (id)
    on delete cascade,

  -- Who or what caused it. Null for the agent.
  actor_id uuid
    references auth.users (id)
    on delete set null,

  -- mention | dm | agent_done | agent_error
  kind text not null,

  title text not null,
  body text not null default '',

  read_at timestamptz,

  created_at timestamptz not null default now()
);

-- The common read is "my unread, newest first".

create index if not exists notifications_inbox_idx
  on public.notifications (user_id, read_at, created_at desc);


alter table public.notifications
  enable row level security;

-- You can only ever see your own.

drop policy if exists
  "Read own notifications"
  on public.notifications;

create policy "Read own notifications"
  on public.notifications
  for select
  using (user_id = auth.uid());

-- Marking read is the only change a person makes.

drop policy if exists
  "Update own notifications"
  on public.notifications;

create policy "Update own notifications"
  on public.notifications
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- A member of the project may notify another
-- member of it. The worker uses the service role
-- and bypasses this.

drop policy if exists
  "Notify project members"
  on public.notifications;

create policy "Notify project members"
  on public.notifications
  for insert
  with check (
    project_id is null
    or exists (
      select 1
        from public.project_members mine
       where mine.project_id = notifications.project_id
         and mine.user_id = auth.uid()
    )
  );


grant select, insert, update
  on public.notifications to authenticated;

grant all privileges
  on public.notifications to service_role;


-- Delivered to the browser as they are written,
-- so a mention lands without a refresh.

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'notifications'
  ) then
    alter publication supabase_realtime
      add table public.notifications;
  end if;
end
$$;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 0008_channel_agents.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- ==========================================
-- AN AGENT PER CHANNEL
-- ==========================================
--
-- A project had one agent that answered
-- everywhere, so research and design questions
-- reached the same generalist with the same
-- instructions.
--
-- Memory is already scoped to a channel, so a
-- channel was half a workspace of its own
-- already. This gives it the other half: its own
-- agent, with its own instructions and model.
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--

-- Which channel an agent belongs to. Null means
-- the older project-wide agent, which still
-- answers in channels that have none of their
-- own.

alter table public.agents
  add column if not exists channel_id uuid
    references public.channels (id)
    on delete cascade;

-- How this particular agent should behave. The
-- description is what people read; this is what
-- the model reads.

alter table public.agents
  add column if not exists instructions text;

create index if not exists agents_channel_idx
  on public.agents (channel_id);

-- One agent per channel, while still allowing
-- several project-wide agents with no channel.

create unique index if not exists agents_channel_unique
  on public.agents (channel_id)
  where channel_id is not null;


-- ------------------------------------------
-- GIVE EVERY EXISTING CHANNEL AN AGENT
-- ------------------------------------------
--
-- Named after the channel, so #design gets a
-- "design agent" rather than an empty seat.
--

insert into public.agents (
  project_id,
  channel_id,
  name,
  description,
  status,
  provider,
  model
)
select
  c.project_id,
  c.id,
  initcap(replace(c.name, '-', ' ')) || ' agent',
  'The agent for #' || c.name || '.',
  'idle',
  'ollama',
  'qwen3:1.7b'
from public.channels c
where not exists (
  select 1
    from public.agents a
   where a.channel_id = c.id
);


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 0009_run_recovery.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- ==========================================
-- RECOVERING RUNS FROM A DEAD WORKER
-- ==========================================
--
-- claim_agent_run only ever looks at runs in the
-- 'queued' state. That is right while a worker
-- is alive, and wrong the moment one is not.
--
-- Kill the worker mid-run - Ctrl+C, a crash, a
-- reboot - and the row stays 'running' with a
-- claim nobody holds. No worker will ever take
-- it again, the dock reports work that is not
-- happening, and the agent sits at 'working'
-- forever. There is no way out of that state
-- from inside the app.
--
-- A run already stores its own messages and step
-- count, so nothing is lost by handing it back
-- to the queue: whoever picks it up next carries
-- on from the step that was interrupted.
--
-- The worker now touches claimed_at while it
-- works, so "the claim has gone quiet" is a
-- reliable signal that the worker behind it is
-- gone.
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--

create or replace function public.reap_stale_runs(
  max_age_seconds integer default 90
)
returns setof public.agent_runs
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  reaped public.agent_runs;
begin
  for reaped in
    update public.agent_runs
       set status = 'queued',
           claimed_at = null,
           claimed_by = null,
           updated_at = now()
     where id in (
       select id
         from public.agent_runs
        where status = 'running'
          and claimed_at is not null
          and claimed_at <
              now() - make_interval(
                secs => max_age_seconds
              )
        for update skip locked
     )
    returning *
  loop
    -- The agent was left mid-sentence too. Say
    -- idle rather than working: nothing is
    -- advancing it until a worker takes it back,
    -- and claiming it sets working again.

    update public.agents
       set status = 'idle',
           updated_at = now()
     where id = reaped.agent_id
       and status = 'working';

    return next reaped;
  end loop;

  return;
end;
$$;


-- A run that has gone quiet is worth finding
-- quickly, and the reaper scans on exactly this.

create index if not exists agent_runs_claim_idx
  on public.agent_runs (status, claimed_at);


-- The worker connects as service_role, and a
-- security definer function still needs to be
-- callable by it.

grant execute
  on function public.reap_stale_runs(integer)
  to service_role;

grant execute
  on function public.claim_agent_run(text)
  to service_role;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 0010_unread.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- ==========================================
-- WHAT HAVE I NOT SEEN
-- ==========================================
--
-- The sidebar has been a flat list of names:
-- nothing in it says where anything happened.
-- The only way to find out whether a teammate
-- or an agent said something in #design was to
-- open #design and look. With one channel that
-- is fine. With five channels and three agents
-- it means opening all eight, every time.
--
-- So: remember where each person had got to,
-- and count what has arrived since.
--
-- Two things deliberately do not count as
-- unread:
--
--   Your own messages. You were there.
--
--   Anything from before you joined. A new
--   teammate should not open the app to a
--   thousand-message backlog marked new.
--
-- An agent's reply does count, even though you
-- may have prompted it - a background agent that
-- finished in another channel is exactly the
-- kind of thing this is for.
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--


-- ------------------------------------------
-- HOW FAR EACH PERSON HAS READ
-- ------------------------------------------

create table if not exists public.channel_reads (
  user_id uuid not null
    references auth.users (id)
    on delete cascade,

  channel_id uuid not null
    references public.channels (id)
    on delete cascade,

  last_read_at timestamptz not null default now(),

  primary key (user_id, channel_id)
);

create table if not exists public.dm_reads (
  user_id uuid not null
    references auth.users (id)
    on delete cascade,

  conversation_id uuid not null
    references public.dm_conversations (id)
    on delete cascade,

  last_read_at timestamptz not null default now(),

  primary key (user_id, conversation_id)
);


-- ------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------
--
-- Where you have read up to is yours alone. No
-- policy lets anyone see anybody else's.
--

alter table public.channel_reads
  enable row level security;

alter table public.dm_reads
  enable row level security;

drop policy if exists
  "Own channel reads" on public.channel_reads;

create policy "Own channel reads"
  on public.channel_reads
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists
  "Own dm reads" on public.dm_reads;

create policy "Own dm reads"
  on public.dm_reads
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


-- ------------------------------------------
-- START EVERYONE FROM ZERO
-- ------------------------------------------
--
-- Without this, the day this ships is the day
-- every existing member opens the app to their
-- entire history marked unread - 106 messages in
-- #general, on a workspace that had never had an
-- unread count to fall behind on. Nobody is
-- behind on messages they have already read.
--
-- So: everyone who is here now is caught up now,
-- and counting starts from this moment. Someone
-- who joins later still falls back to their join
-- date, which for them is the right answer.
--
-- do nothing on conflict, so re-running this
-- never moves a marker that already exists.
--

insert into public.channel_reads (
  user_id, channel_id, last_read_at
)
select pm.user_id, c.id, now()
  from public.project_members pm
  join public.channels c
    on c.project_id = pm.project_id
on conflict (user_id, channel_id) do nothing;

insert into public.dm_reads (
  user_id, conversation_id, last_read_at
)
select m.user_id, m.conversation_id, now()
  from public.dm_members m
on conflict (user_id, conversation_id) do nothing;


-- ------------------------------------------
-- COUNTING, IN ONE ROUND TRIP
-- ------------------------------------------
--
-- The sidebar needs every channel at once. Asked
-- one channel at a time this would be a query
-- per channel on every poll, so it is a single
-- grouped count instead.
--

create or replace function public.unread_channels(
  p_project_id uuid
)
returns table (
  channel_id uuid,
  unread bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select c.id,
         count(m.id)

    from public.channels c

    join public.project_members pm
      on pm.project_id = c.project_id
     and pm.user_id = auth.uid()

    left join public.channel_reads r
      on r.channel_id = c.id
     and r.user_id = auth.uid()

    -- Falling back to the moment you joined is
    -- what keeps a new member's first login from
    -- being a wall of unread history.

    left join public.messages m
      on m.channel_id = c.id
     and m.user_id is distinct from auth.uid()
     and m.created_at > coalesce(
           r.last_read_at,
           pm.created_at
         )

   where c.project_id = p_project_id

   group by c.id;
$$;


create or replace function public.unread_dms()
returns table (
  conversation_id uuid,
  other_user_id uuid,
  unread bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select me.conversation_id,
         them.user_id,
         count(dm.id)

    from public.dm_members me

    -- The sidebar lists people, not conversation
    -- ids, so the other member comes back with
    -- the count.

    join public.dm_members them
      on them.conversation_id = me.conversation_id
     and them.user_id <> me.user_id

    left join public.dm_reads r
      on r.conversation_id = me.conversation_id
     and r.user_id = me.user_id

    left join public.dm_messages dm
      on dm.conversation_id = me.conversation_id
     and dm.user_id <> me.user_id
     and dm.created_at > coalesce(
           r.last_read_at,
           me.created_at
         )

   where me.user_id = auth.uid()

   group by me.conversation_id, them.user_id;
$$;


-- ------------------------------------------
-- GRANTS
-- ------------------------------------------

grant select, insert, update, delete
  on public.channel_reads,
     public.dm_reads
  to authenticated;

grant all privileges
  on public.channel_reads,
     public.dm_reads
  to service_role;

grant execute
  on function public.unread_channels(uuid)
  to authenticated;

grant execute
  on function public.unread_dms()
  to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 0011_identity.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- ==========================================
-- WHO PEOPLE ARE, AND WHO ELSE IS HERE
-- ==========================================
--
-- Two gaps that turn out to be the same gap.
--
-- Everybody in the app is their email address.
-- The sidebar says someone@example.com, DMs
-- are addressed to an inbox, and mentions are
-- built out of whatever is left after stripping
-- the @. Nobody calls a colleague by their email
-- address.
--
-- And there was no way to get a second person
-- into a project at all. Both existing members
-- are there because somebody wrote the row by
-- hand.
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--


-- ------------------------------------------
-- A NAME AND A HANDLE
-- ------------------------------------------
--
-- display_name is what people read. username is
-- what they type after an @, so it is unique,
-- lowercase and has no spaces in it.
--

alter table public.profiles
  add column if not exists username text;

-- Case matters for uniqueness but not for
-- typing, so the index is on the lowered form
-- and two people cannot take Jan and jan.

create unique index if not exists
  profiles_username_key
  on public.profiles (lower(username))
  where username is not null;

-- "agent" addresses the AI, and letting someone
-- take it would make every mention ambiguous.

alter table public.profiles
  drop constraint if exists profiles_username_shape;

alter table public.profiles
  add constraint profiles_username_shape
  check (
    username is null
    or (
      username ~ '^[a-zA-Z0-9_.-]{2,24}$'
      and lower(username) <> 'agent'
      and lower(username) <> 'everyone'
      and lower(username) <> 'channel'
    )
  );


-- ------------------------------------------
-- SEED FROM WHAT IS ALREADY THERE
-- ------------------------------------------
--
-- The local part of the address is a reasonable
-- first guess, and people can change it. Anyone
-- whose guess collides keeps a null username
-- until they pick one, rather than being handed
-- somebody else's name with a number stuck on.
--

update public.profiles p
   set username = candidate.value
  from (
    select id,
           regexp_replace(
             split_part(email, '@', 1),
             '[^a-zA-Z0-9_.-]',
             '',
             'g'
           ) as value
      from public.profiles
  ) as candidate
 where p.id = candidate.id
   and p.username is null
   and length(candidate.value) between 2 and 24
   and lower(candidate.value) not in (
     'agent', 'everyone', 'channel'
   )
   and not exists (
     select 1
       from public.profiles other
      where other.id <> p.id
        and lower(other.username) =
            lower(candidate.value)
   );


-- ------------------------------------------
-- EDITING YOUR OWN PROFILE
-- ------------------------------------------
--
-- Reading is open to anyone signed in, because
-- the whole point is seeing who your teammates
-- are. Writing is yours alone.
--

alter table public.profiles
  enable row level security;

drop policy if exists
  "Signed in can read profiles"
  on public.profiles;

create policy "Signed in can read profiles"
  on public.profiles
  for select
  to authenticated
  using (true);

drop policy if exists
  "Own profile is editable"
  on public.profiles;

create policy "Own profile is editable"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());


-- ------------------------------------------
-- INVITING SOMEBODY
-- ------------------------------------------
--
-- An invite is by email, because that is all you
-- know about someone who has not signed up yet.
--
-- If they already have an account they are added
-- straight to the project. If they do not, the
-- invite waits here until they sign up, and is
-- claimed on their first visit.
--

create table if not exists public.project_invites (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id)
    on delete cascade,

  -- Stored lowercase; addresses are matched
  -- case-insensitively.
  email text not null,

  role text not null default 'member',

  invited_by uuid
    references auth.users (id)
    on delete set null,

  created_at timestamptz not null default now(),

  accepted_at timestamptz,

  unique (project_id, email)
);

create index if not exists
  project_invites_email_idx
  on public.project_invites (email)
  where accepted_at is null;


alter table public.project_invites
  enable row level security;

-- Members of a project can see and manage its
-- invites.

drop policy if exists
  "Members manage invites"
  on public.project_invites;

create policy "Members manage invites"
  on public.project_invites
  for all
  to authenticated
  using (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id =
             project_invites.project_id
         and pm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id =
             project_invites.project_id
         and pm.user_id = auth.uid()
    )
  );

-- And you can always see an invite addressed to
-- you, which is how one gets claimed.

drop policy if exists
  "See invites addressed to me"
  on public.project_invites;

create policy "See invites addressed to me"
  on public.project_invites
  for select
  to authenticated
  using (
    lower(email) = lower(
      coalesce(auth.jwt() ->> 'email', '')
    )
  );


-- ------------------------------------------
-- CLAIMING WHAT IS WAITING FOR YOU
-- ------------------------------------------
--
-- Called when someone opens the app. Turns every
-- unaccepted invite for their address into
-- membership, and does nothing at all if there
-- are none.
--
-- security definer because joining a project
-- means writing a project_members row for a
-- project you are, by definition, not yet a
-- member of.
--

create or replace function public.claim_invites()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  claimed integer := 0;
  address text;
begin
  address := lower(
    coalesce(auth.jwt() ->> 'email', '')
  );

  if address = '' then
    return 0;
  end if;

  insert into public.project_members (
    project_id, user_id, role
  )
  select i.project_id, auth.uid(), i.role
    from public.project_invites i
   where lower(i.email) = address
     and i.accepted_at is null
  on conflict do nothing;

  update public.project_invites
     set accepted_at = now()
   where lower(email) = address
     and accepted_at is null;

  get diagnostics claimed = row_count;

  return claimed;
end;
$$;


grant select, insert, update, delete
  on public.project_invites
  to authenticated;

grant all privileges
  on public.project_invites
  to service_role;

grant execute
  on function public.claim_invites()
  to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 0012_connections.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- ==========================================
-- CONNECTED ACCOUNTS
-- ==========================================
--
-- Somewhere to keep the tokens that let an agent
-- read your spreadsheet or your calendar.
--
-- This is a different thing from signing in.
-- Signing in proves who you are, once, and
-- Supabase holds that. A connection is standing
-- permission to act on your behalf later, while
-- you are not looking - so it needs a refresh
-- token, which the sign-in flow neither asks for
-- nor keeps.
--
-- One row per person per provider. Connecting
-- again replaces it rather than piling up.
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--

create table if not exists public.connections (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references auth.users (id)
    on delete cascade,

  -- 'google' today. One row per provider, so the
  -- name is part of the key.
  provider text not null,

  -- Which account was connected. Shown in
  -- settings so it is obvious whose mailbox or
  -- spreadsheet the agent is reaching into -
  -- people have more than one Google account and
  -- picking the wrong one is easy.
  account_email text,

  access_token text not null,

  -- Absent when the provider did not send one,
  -- which means the connection dies at expiry
  -- and has to be made again.
  refresh_token text,

  expires_at timestamptz,

  -- What was actually granted, which is not
  -- always what was asked for: Google lets people
  -- untick individual permissions.
  scopes text[] not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, provider)
);

create index if not exists connections_user_idx
  on public.connections (user_id);


-- ------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------
--
-- These rows are credentials. Nobody sees
-- anybody else's, and no policy makes them
-- readable to a project, a channel or a
-- teammate.
--
-- The tokens never leave the server either: the
-- API that reads this table returns which
-- account is connected and what it may do, never
-- the token itself.
--

alter table public.connections
  enable row level security;

drop policy if exists
  "Own connections" on public.connections;

create policy "Own connections"
  on public.connections
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


grant select, insert, update, delete
  on public.connections
  to authenticated;

grant all privileges
  on public.connections
  to service_role;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 0013_dm_attachments.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- ==========================================
-- FILES IN A DIRECT MESSAGE
-- ==========================================
--
-- Attachments were built for channels and only
-- ever described one: project_id is NOT NULL,
-- message_id points at public.messages, and
-- every policy asks whether you are in the
-- project.
--
-- A direct message has none of those. It has no
-- project - two people can share a file without
-- it belonging to any of their projects - and
-- its rows live in dm_messages.
--
-- So the row learns a second home, and the
-- policies learn a second question. Anything
-- already stored keeps the shape it has: a
-- channel attachment still has a project and no
-- conversation, and nothing about it changes.
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--


-- ------------------------------------------
-- A SECOND PLACE TO BELONG
-- ------------------------------------------

alter table public.attachments
  add column if not exists conversation_id uuid
    references public.dm_conversations (id)
    on delete cascade;

-- Set once the message it belongs to is sent.
-- Null means uploaded but not yet posted, same
-- as message_id in a channel.

alter table public.attachments
  add column if not exists dm_message_id uuid
    references public.dm_messages (id)
    on delete cascade;

create index if not exists
  attachments_dm_message_idx
  on public.attachments (dm_message_id);

create index if not exists
  attachments_conversation_idx
  on public.attachments (conversation_id, created_at desc);


-- A DM attachment has no project, so the column
-- can no longer insist on one.

alter table public.attachments
  alter column project_id drop not null;


-- One home or the other, never neither and never
-- both. Without this a row with nothing set
-- would be readable by nobody and deletable by
-- nothing.

alter table public.attachments
  drop constraint if exists attachments_belongs_somewhere;

alter table public.attachments
  add constraint attachments_belongs_somewhere
  check (
    (project_id is not null
     and conversation_id is null)
    or
    (conversation_id is not null
     and project_id is null)
  );


-- ------------------------------------------
-- WHO MAY SEE THEM
-- ------------------------------------------
--
-- The existing policies ask about project
-- membership and answer false for a DM row,
-- since its project_id is null. Rather than
-- widen them and risk loosening the channel
-- case, DMs get their own - a row is reachable
-- if you are in the project, or if you are in
-- the conversation.
--

drop policy if exists
  "DM members read attachments"
  on public.attachments;

create policy "DM members read attachments"
  on public.attachments
  for select
  to authenticated
  using (
    conversation_id is not null
    and exists (
      select 1
        from public.dm_members m
       where m.conversation_id =
             attachments.conversation_id
         and m.user_id = auth.uid()
    )
  );

drop policy if exists
  "DM members add attachments"
  on public.attachments;

create policy "DM members add attachments"
  on public.attachments
  for insert
  to authenticated
  with check (
    conversation_id is not null
    and exists (
      select 1
        from public.dm_members m
       where m.conversation_id =
             attachments.conversation_id
         and m.user_id = auth.uid()
    )
  );

drop policy if exists
  "DM members update attachments"
  on public.attachments;

create policy "DM members update attachments"
  on public.attachments
  for update
  to authenticated
  using (
    conversation_id is not null
    and exists (
      select 1
        from public.dm_members m
       where m.conversation_id =
             attachments.conversation_id
         and m.user_id = auth.uid()
    )
  );


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 0014_edit_delete.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- ==========================================
-- CHANGING YOUR MIND
-- ==========================================
--
-- Nothing written here could ever be edited or
-- taken back. A typo to your team was permanent,
-- and so was anything sent to the wrong channel.
--
-- Two rules, and they are different on purpose:
--
--   You may edit your own message. Not anybody
--   else's, and not the agent's - putting words
--   in its mouth would make the whole transcript
--   worthless as a record of what it said.
--
--   You may delete your own message, and anyone
--   in the project may delete the agent's. An
--   agent reply is not anybody's to defend, and
--   a wrong one left sitting in a channel is
--   just clutter.
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--


-- ------------------------------------------
-- SAYING SO
-- ------------------------------------------
--
-- An edited message that does not admit it is a
-- small dishonesty, and in a shared channel
-- other people have already read the first
-- version.
--

alter table public.messages
  add column if not exists edited_at timestamptz;

alter table public.dm_messages
  add column if not exists edited_at timestamptz;


-- ------------------------------------------
-- CHANNEL MESSAGES
-- ------------------------------------------

drop policy if exists
  "Authors edit their own messages"
  on public.messages;

create policy "Authors edit their own messages"
  on public.messages
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


drop policy if exists
  "Delete your own, or the agent's"
  on public.messages;

create policy "Delete your own, or the agent's"
  on public.messages
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    or (
      -- The agent writes with no author. Anyone
      -- in the project may clear those.
      user_id is null
      and exists (
        select 1
          from public.project_members pm
         where pm.project_id = messages.project_id
           and pm.user_id = auth.uid()
      )
    )
  );


-- ------------------------------------------
-- DIRECT MESSAGES
-- ------------------------------------------
--
-- No agent here, so there is only the one rule.
--

drop policy if exists
  "Authors edit their own DMs"
  on public.dm_messages;

create policy "Authors edit their own DMs"
  on public.dm_messages
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


drop policy if exists
  "Authors delete their own DMs"
  on public.dm_messages;

create policy "Authors delete their own DMs"
  on public.dm_messages
  for delete
  to authenticated
  using (user_id = auth.uid());


grant update, delete
  on public.messages,
     public.dm_messages
  to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 0015_provider_keys.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- ==========================================
-- BRING YOUR OWN MODEL KEY
-- ==========================================
--
-- Model keys lived in .env.local, which means
-- one workspace, one bill, and the person paying
-- is whoever owns the server. That is the wrong
-- shape for a product other people run: a key
-- belongs to the person whose account it bills.
--
-- The connections table already holds exactly
-- this - a secret per person per provider, with
-- row level security keeping each to its owner
-- and an API that never returns the secret. An
-- API key fits it without changes: the key goes
-- in access_token, and there is nothing to
-- refresh.
--
-- What it needs is somewhere to put the rest.
-- An OpenAI-compatible endpoint needs a base
-- URL, because Groq, DeepSeek, OpenRouter,
-- Together, a company's own vLLM server and half
-- a dozen others are the same API at different
-- addresses.
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--

alter table public.connections
  add column if not exists config jsonb
    not null default '{}'::jsonb;


-- A key has no expiry to track and nothing to
-- refresh, so those columns simply stay null for
-- these rows. Nothing to change.

comment on column public.connections.config is
  'Provider-specific settings. For an OpenAI-compatible endpoint: base_url, and a label for the service.';


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 0016_shared_keys.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- ==========================================
-- WHOSE MODEL, AND WHOSE BILL
-- ==========================================
--
-- Two things were incoherent.
--
-- The model a channel answered with came from
-- localStorage, so it was per browser rather than
-- per person, and two people in the same channel
-- got two different models from one agent that
-- has one name, one set of instructions and one
-- memory.
--
-- And a key belonged to one person. That is right
-- for a developer trying things out and wrong for
-- a company: a design team will not each open an
-- Anthropic account. Somebody buys one key and
-- the team draws on it.
--
-- So: the channel picks the model, and the key is
-- resolved yours-then-the-project's-then-local.
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--


-- ------------------------------------------
-- A MODEL THAT FOLLOWS YOU
-- ------------------------------------------
--
-- Used when a channel has not been given one of
-- its own, and as the default for anything
-- personal. On your profile rather than in the
-- browser, so signing in on a phone does not
-- silently change which model answers.
--

alter table public.profiles
  add column if not exists default_model text;


-- ------------------------------------------
-- A KEY THE PROJECT SHARES
-- ------------------------------------------

create table if not exists public.project_model_keys (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id)
    on delete cascade,

  -- anthropic | openai | groq | ...
  service text not null,

  label text,

  access_token text not null,

  -- For everything that is OpenAI's API at a
  -- different address.
  base_url text,

  models jsonb not null default '[]'::jsonb,

  added_by uuid
    references auth.users (id)
    on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (project_id, service)
);

create index if not exists
  project_model_keys_project_idx
  on public.project_model_keys (project_id);


-- ------------------------------------------
-- WHO MAY TOUCH IT
-- ------------------------------------------
--
-- Deliberately strict, and worth explaining.
--
-- Everyone in the project may *use* this key -
-- that is the whole point - but nobody may read
-- it, including them. A policy letting members
-- select the row would let any of them pull the
-- key straight out of the database from a browser
-- and walk off with it.
--
-- So the row is readable only by the person who
-- added it. The server reads it with the service
-- role when it needs to send a request, and no
-- API ever returns the token.
--

alter table public.project_model_keys
  enable row level security;

drop policy if exists
  "Owners read their project keys"
  on public.project_model_keys;

create policy "Owners read their project keys"
  on public.project_model_keys
  for select
  to authenticated
  using (added_by = auth.uid());


-- Adding and removing is for whoever owns the
-- project, since it is their bill.

drop policy if exists
  "Owners manage project keys"
  on public.project_model_keys;

create policy "Owners manage project keys"
  on public.project_model_keys
  for all
  to authenticated
  using (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id =
             project_model_keys.project_id
         and pm.user_id = auth.uid()
         and pm.role = 'owner'
    )
  )
  with check (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id =
             project_model_keys.project_id
         and pm.user_id = auth.uid()
         and pm.role = 'owner'
    )
  );


grant select, insert, update, delete
  on public.project_model_keys
  to authenticated;

grant all privileges
  on public.project_model_keys
  to service_role;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 0017_spend.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- ==========================================
-- WHO SPENT IT, AND HOW MUCH IS LEFT
-- ==========================================
--
-- A shared project key means one person's card
-- pays for other people's messages. That is the
-- right shape for a company and a bad shape
-- without two things: the owner being able to see
-- where the money went, and a ceiling.
--
-- Without a ceiling, one agent left in a loop
-- overnight is somebody else's bill in the
-- morning, and the first they hear of it is the
-- invoice.
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--


-- ------------------------------------------
-- WHOSE KEY PAID
-- ------------------------------------------
--
-- Tokens were already recorded per person and per
-- project. What was missing is whose account they
-- were charged to, which is the difference
-- between "Sam used a lot of Claude" and "Sam
-- used a lot of Claude on my card".
--
--   you      - their own key
--   project  - the shared one
--   server   - an environment variable
--   local    - the machine, which costs nothing
--

alter table public.usage_events
  add column if not exists paid_by text
    not null default 'local';

create index if not exists
  usage_events_project_month_idx
  on public.usage_events
     (project_id, created_at desc);


-- ------------------------------------------
-- A CEILING ON THE SHARED KEY
-- ------------------------------------------
--
-- Null means no limit, which is the honest
-- default: a limit somebody did not choose would
-- stop their work at a number they never saw.
--
-- Dollars rather than tokens, because that is the
-- unit the bill arrives in and the only one
-- anybody reasons about.
--

alter table public.project_model_keys
  add column if not exists monthly_limit_usd
    numeric(10, 2);


-- ------------------------------------------
-- WHAT THE PROJECT HAS SPENT THIS MONTH
-- ------------------------------------------
--
-- Costed in the application rather than here,
-- since prices belong with the model catalogue
-- and change without a migration. This just adds
-- up the tokens that were charged to the shared
-- key.
--
-- security invoker, so it answers about projects
-- the caller is in and no others.
--

create or replace function public.project_spend(
  p_project_id uuid,
  p_since timestamptz
)
returns table (
  user_id uuid,
  model text,
  paid_by text,
  prompt_tokens bigint,
  response_tokens bigint,
  turns bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select u.user_id,
         u.model,
         u.paid_by,
         sum(u.prompt_tokens)::bigint,
         sum(u.response_tokens)::bigint,
         count(*)::bigint

    from public.usage_events u

    join public.project_members pm
      on pm.project_id = u.project_id
     and pm.user_id = auth.uid()

   where u.project_id = p_project_id
     and u.created_at >= p_since

   group by u.user_id, u.model, u.paid_by;
$$;


grant execute
  on function public.project_spend(uuid, timestamptz)
  to authenticated;




-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 0018_memory_sources.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- ==========================================
-- FORGET WHAT A DELETED MESSAGE TAUGHT IT
-- ==========================================
--
-- Facts the agent picks up now record the
-- message they were learned from. Deleting that
-- message deletes them with it.
--
-- Facts remembered before this ran have no link
-- and stay until cleared. To start clean:
--
--   delete from public.memory_facts
--    where source_message_id is null;
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--

alter table public.memory_facts
  add column if not exists source_message_id uuid
    references public.messages (id)
    on delete cascade;

create index if not exists
  memory_facts_source_message_idx
  on public.memory_facts (source_message_id);


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 0019_plans.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- ==========================================
-- PLANS
-- ==========================================
--
-- Which plan each person is on. Free is the
-- built-in model; bringing your own API key needs
-- Pro or Team; sharing a key with a whole project
-- needs the owner to be on Team.
--
-- People can read their own row and write
-- nothing. Only the server (payments, later) or
-- you in this editor can change a plan, so nobody
-- upgrades themselves from the browser.
--
-- Until payments exist, set a plan by hand:
--
--   insert into public.subscriptions (user_id, plan)
--   select id, 'pro' from auth.users
--    where email = 'someone@example.com'
--   on conflict (user_id)
--   do update set plan = excluded.plan,
--                 updated_at = now();
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--

create table if not exists public.subscriptions (
  user_id uuid primary key
    references auth.users (id)
    on delete cascade,

  plan text not null default 'free'
    check (plan in ('free', 'pro', 'team')),

  -- When a paid plan runs out. Null means it does
  -- not, which is what a plan set by hand wants.
  current_period_end timestamptz,

  updated_at timestamptz not null default now()
);

alter table public.subscriptions
  enable row level security;

drop policy if exists
  "People read their own plan"
  on public.subscriptions;

create policy "People read their own plan"
  on public.subscriptions
  for select
  using (user_id = auth.uid());


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 0020_team_plans.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- ==========================================
-- FREE, TEAM, TEAM+
-- ==========================================
--
-- Pro is gone. This is a team product, so plans
-- belong to the project owner and cover everyone
-- in their projects:
--
--   free       - basic built-in model, small
--                daily allowance
--   team       - stronger model, more messages,
--                API keys
--   team_plus  - best model, the most messages,
--                the spend report
--
-- Anyone set to 'pro' by hand becomes 'team', and
-- anyone on the old 'team' becomes 'team_plus', so
-- nobody loses what they had. That happens once:
-- the new constraint existing is the sign it has
-- already run.
--
-- Run this once in the Supabase SQL editor, after
-- 0019. It is safe to run more than once.
--

alter table public.subscriptions
  drop constraint if exists subscriptions_plan_check;

update public.subscriptions
   set plan = case plan
                when 'team' then 'team_plus'
                when 'pro'  then 'team'
              end,
       updated_at = now()
 where plan in ('pro', 'team')
   and not exists (
     select 1
       from pg_constraint
      where conname = 'subscriptions_plan_check_v2'
   );

alter table public.subscriptions
  drop constraint if exists subscriptions_plan_check_v2;

alter table public.subscriptions
  add constraint subscriptions_plan_check_v2
  check (plan in ('free', 'team', 'team_plus'));


-- Counting today's built-in messages is one
-- query per turn, by person and time.

create index if not exists
  usage_events_user_day_idx
  on public.usage_events
     (user_id, created_at desc);


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 0021_mcp.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- ==========================================
-- APPS OVER MCP
-- ==========================================
--
-- A connected MCP server: Notion, Linear, Jira
-- and the rest, each reached over the Model
-- Context Protocol instead of an integration
-- written by hand.
--
-- One row per person per server. Like the other
-- connections, it belongs to whoever connected it
-- and the agent acts as them - so the same row
-- level security: your own rows, nobody else's.
--
-- Only remote servers. A local MCP server is a
-- program, and running somebody's program on this
-- machine is not something a settings page should
-- be able to do.
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--

create table if not exists public.mcp_servers (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references auth.users (id)
    on delete cascade,

  -- Which entry in the app's list, or null for a
  -- server somebody added by address.
  catalog_id text,

  name text not null,

  url text not null,

  transport text not null default 'http'
    check (transport in ('http', 'sse')),

  auth_type text not null default 'oauth'
    check (auth_type in ('oauth', 'token', 'none')),

  status text not null default 'pending'
    check (status in ('pending', 'connected', 'error')),

  error text,

  -- A pasted token, for servers that take one.
  access_token text,

  -- The sign-in, as the MCP SDK keeps it: the
  -- client it registered, the tokens it was given,
  -- and what it learned about the server.
  oauth_client jsonb,
  oauth_tokens jsonb,
  oauth_discovery jsonb,

  -- Only while a sign-in is in progress.
  code_verifier text,
  oauth_state text,

  redirect_url text,

  -- What the server offers, kept so a chat turn
  -- does not have to ask it every time.
  tools jsonb not null default '[]'::jsonb,
  tools_fetched_at timestamptz,

  enabled boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, url)
);

create index if not exists mcp_servers_state_idx
  on public.mcp_servers (oauth_state)
  where oauth_state is not null;

alter table public.mcp_servers
  enable row level security;

drop policy if exists
  "People manage their own MCP servers"
  on public.mcp_servers;

create policy "People manage their own MCP servers"
  on public.mcp_servers
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 0022_agent_templates.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- ==========================================
-- WHICH TEMPLATE AN AGENT STARTED FROM
-- ==========================================
--
-- A channel made from "Meeting notes" should
-- offer meeting-notes first messages when it is
-- empty. The instructions themselves are copied
-- onto the agent and can be edited freely; this
-- only remembers where they came from.
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--

alter table public.agents
  add column if not exists template_id text;

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 0023_agent_schedules.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- ==========================================
-- AGENTS ON A SCHEDULE
-- ==========================================
--
-- "Every Monday at 9, summarise last week in
-- #general." A schedule belongs to a channel and
-- runs that channel's agent. The worker looks for
-- schedules that are due, moves each one's next
-- time forward, and queues an ordinary agent run -
-- so a scheduled run can be watched, paused and
-- stopped like any other. Its answer is posted in
-- the channel.
--
-- The next time is worked out by the worker in the
-- schedule's own timezone (lib/agents/schedule.ts)
-- and stored, so "what is due" is one indexed
-- query.
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--

create table if not exists public.agent_schedules (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id)
    on delete cascade,

  channel_id uuid not null
    references public.channels (id)
    on delete cascade,

  -- Whose allowance and connected apps the runs
  -- use. Left null if they delete their account;
  -- the worker then turns the schedule off.
  created_by uuid
    references auth.users (id)
    on delete set null,

  title text not null default 'Scheduled task'
    check (char_length(title) between 1 and 80),

  task text not null
    check (char_length(task) between 1 and 2000),

  cadence text not null
    check (cadence in ('daily', 'weekdays', 'weekly', 'monthly')),

  time_of_day text not null
    check (time_of_day ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),

  weekday smallint check (weekday between 0 and 6),

  month_day smallint check (month_day between 1 and 28),

  timezone text not null default 'Asia/Kolkata',

  enabled boolean not null default true,

  next_run_at timestamptz not null,

  last_run_at timestamptz,

  last_run_id uuid
    references public.agent_runs (id)
    on delete set null,

  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_schedules_due_idx
  on public.agent_schedules (next_run_at)
  where enabled;

create index if not exists agent_schedules_channel_idx
  on public.agent_schedules (channel_id);


-- Which schedule started a run, so its answer can
-- be posted in the channel when it finishes.

alter table public.agent_runs
  add column if not exists schedule_id uuid
    references public.agent_schedules (id)
    on delete set null;


alter table public.agent_schedules enable row level security;

-- Everyone in the project can see what is
-- scheduled in it.

drop policy if exists "Project members read schedules"
  on public.agent_schedules;

create policy "Project members read schedules"
  on public.agent_schedules
  for select
  using (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = agent_schedules.project_id
         and pm.user_id = auth.uid()
    )
  );

-- Any member can add one, as themselves.

drop policy if exists "Project members add schedules"
  on public.agent_schedules;

create policy "Project members add schedules"
  on public.agent_schedules
  for insert
  with check (
    created_by = auth.uid()
    and exists (
      select 1
        from public.project_members pm
       where pm.project_id = agent_schedules.project_id
         and pm.user_id = auth.uid()
    )
  );

-- Whoever made it, or an owner of the project, can
-- change or remove it.

drop policy if exists "Creators and owners change schedules"
  on public.agent_schedules;

create policy "Creators and owners change schedules"
  on public.agent_schedules
  for update
  using (
    created_by = auth.uid()
    or exists (
      select 1
        from public.project_members pm
       where pm.project_id = agent_schedules.project_id
         and pm.user_id = auth.uid()
         and pm.role = 'owner'
    )
  );

drop policy if exists "Creators and owners remove schedules"
  on public.agent_schedules;

create policy "Creators and owners remove schedules"
  on public.agent_schedules
  for delete
  using (
    created_by = auth.uid()
    or exists (
      select 1
        from public.project_members pm
       where pm.project_id = agent_schedules.project_id
         and pm.user_id = auth.uid()
         and pm.role = 'owner'
    )
  );


-- ==========================================
-- A NEW CHANNEL FOLLOWS YOUR MODEL
-- ==========================================
--
-- agents.model was required and defaulted to a
-- local model, so every new channel was pinned to
-- it - and a channel's model wins over the one
-- each person picked, so connecting Gemini did not
-- change what a new channel answered with. Empty
-- now means "whatever the person asking has
-- chosen". Channels someone has set keep theirs.

alter table public.agents
  alter column model drop not null;

alter table public.agents
  alter column model drop default;

notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 0024_security_rls.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- ==========================================
-- CLOSING FIVE WAYS IN
-- ==========================================
--
-- The browser talks to the database directly with
-- an anonymous key, so row level security is the
-- real fence, not the API. A security audit with
-- two throwaway accounts found five places where
-- the fence had a gap. This closes each one, and
-- only that one - the working policies beside them
-- are left alone.
--
-- 1. Any signed-in person could read EVERY user's
--    profile, including their email. Now: your own,
--    and people you share a project with.
--
-- 2. A project member could add anyone (including
--    an alt account) as an OWNER. Now: members may
--    add others only as members; owner is set by
--    the server alone (creating a project, or
--    handover when an account is deleted).
--
-- 3. A member could post a message as ANOTHER
--    person, or as the agent. Now: you can only
--    post as yourself; the agent's own replies
--    (no author) are still allowed.
--
-- 4. A member could invite someone - or an alt
--    account - as an OWNER. Now: invites are for
--    members only.
--
-- 5. A member could record usage against another
--    person, burning their daily allowance. Now:
--    usage is recorded only against yourself.
--
-- Run this once in the Supabase SQL editor. Safe
-- to run more than once.
--


-- ------------------------------------------
-- HELPERS
-- ------------------------------------------
--
-- Security definer, so a policy on
-- project_members can ask about project_members
-- without asking itself in a loop.
--

create or replace function public.is_project_member(target_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.project_members pm
     where pm.project_id = target_project
       and pm.user_id = auth.uid()
  );
$$;

create or replace function public.is_project_owner(target_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.project_members pm
     where pm.project_id = target_project
       and pm.user_id = auth.uid()
       and pm.role = 'owner'
  );
$$;

-- Do we share any project with this person? Used
-- to decide whose profile you may see.

create or replace function public.shares_a_project(other_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.project_members mine
      join public.project_members theirs
        on theirs.project_id = mine.project_id
     where mine.user_id = auth.uid()
       and theirs.user_id = other_user
  );
$$;

grant execute on function public.is_project_member(uuid) to authenticated;
grant execute on function public.is_project_owner(uuid) to authenticated;
grant execute on function public.shares_a_project(uuid) to authenticated;


-- ------------------------------------------
-- 1. PROFILES: ONLY TEAMMATES, NOT EVERYONE
-- ------------------------------------------

drop policy if exists "Signed in can read profiles" on public.profiles;

create policy "Read your own and teammates' profiles"
  on public.profiles
  for select
  to authenticated
  using (
    id = auth.uid()
    or public.shares_a_project(id)
  );


-- ------------------------------------------
-- 2. PROJECT MEMBERS: NO SELF-MADE OWNERS
-- ------------------------------------------
--
-- Drop only the INSERT policies, by whatever they
-- are named, and put back one that allows a member
-- to add others as members. Read, update and
-- delete are left as they are.
--

do $$
declare pol record;
begin
  for pol in
    select policyname
      from pg_policies
     where schemaname = 'public'
       and tablename = 'project_members'
       and cmd = 'INSERT'
  loop
    execute format(
      'drop policy if exists %I on public.project_members',
      pol.policyname
    );
  end loop;
end $$;

create policy "Members add members, not owners"
  on public.project_members
  for insert
  to authenticated
  with check (
    role = 'member'
    and public.is_project_member(project_id)
  );


-- ------------------------------------------
-- 3. MESSAGES: POST ONLY AS YOURSELF
-- ------------------------------------------
--
-- Replace only the INSERT policy. A person posts
-- as themselves; the agent's replies carry no
-- author and are allowed for anyone in the project
-- (the app writes those after the model answers).
--

do $$
declare pol record;
begin
  for pol in
    select policyname
      from pg_policies
     where schemaname = 'public'
       and tablename = 'messages'
       and cmd = 'INSERT'
  loop
    execute format(
      'drop policy if exists %I on public.messages',
      pol.policyname
    );
  end loop;
end $$;

create policy "Post as yourself, or the agent"
  on public.messages
  for insert
  to authenticated
  with check (
    public.is_project_member(project_id)
    and (
      (role = 'user' and user_id = auth.uid())
      or (role = 'assistant' and user_id is null)
    )
  );


-- ------------------------------------------
-- 4. INVITES: MEMBERS ONLY, NEVER OWNERS
-- ------------------------------------------
--
-- The single "manage invites" rule let a member
-- insert an invite with any role. Split it: still
-- readable and removable by members, but an insert
-- may only be for a member.
--

drop policy if exists "Members manage invites" on public.project_invites;

create policy "Members read invites"
  on public.project_invites
  for select
  to authenticated
  using (public.is_project_member(project_id));

create policy "Members send member invites"
  on public.project_invites
  for insert
  to authenticated
  with check (
    coalesce(role, 'member') = 'member'
    and public.is_project_member(project_id)
  );

create policy "Members update invites"
  on public.project_invites
  for update
  to authenticated
  using (public.is_project_member(project_id))
  with check (
    coalesce(role, 'member') = 'member'
    and public.is_project_member(project_id)
  );

create policy "Members withdraw invites"
  on public.project_invites
  for delete
  to authenticated
  using (public.is_project_member(project_id));


-- ------------------------------------------
-- 5. USAGE: RECORDED ONLY AGAINST YOURSELF
-- ------------------------------------------

drop policy if exists "Project members write usage" on public.usage_events;

create policy "Record your own usage"
  on public.usage_events
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_project_member(project_id)
  );


notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 0025_profiles_read.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- ==========================================
-- PROFILES: DROP EVERY READ RULE, KEEP ONE
-- ==========================================
--
-- Migration 0024 replaced the read policy named
-- "Signed in can read profiles", but a second,
-- older read policy under a different name was
-- still letting any signed-in person read every
-- profile - and every email. This drops ALL read
-- policies on profiles, whatever they are called
-- (including any catch-all "for all" policy), and
-- puts back exactly two rules:
--
--   read   your own profile, and profiles of
--          people you share a project with
--   write  your own profile only
--
-- The write rule is recreated too, in case the
-- catch-all that is being dropped was the only
-- thing granting it. However profiles are first
-- created (a signup trigger) is untouched.
--
-- Run this once in the Supabase SQL editor. Safe
-- to run more than once.
--

do $$
declare pol record;
begin
  for pol in
    select policyname, cmd
      from pg_policies
     where schemaname = 'public'
       and tablename = 'profiles'
       and cmd in ('SELECT', 'UPDATE', 'ALL')
  loop
    execute format(
      'drop policy if exists %I on public.profiles',
      pol.policyname
    );
  end loop;
end $$;

create policy "Read your own and teammates' profiles"
  on public.profiles
  for select
  to authenticated
  using (
    id = auth.uid()
    or public.shares_a_project(id)
  );

create policy "Own profile is editable"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 0026_agent_message_from_server.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- ==========================================
-- NO FORGED "AGENT" MESSAGES
-- ==========================================
--
-- Until now the agent's reply was saved by the
-- browser, so the message-insert rule had to allow
-- an agent message (role 'assistant', no author)
-- from any project member. That let a member post
-- a fake "Agent" message straight to the database -
-- an authoritative-looking "Agent: send me your
-- password" inside a project they are in.
--
-- The server now saves the agent's reply itself
-- (app/api/chat), with the service role, which
-- bypasses these rules. So a member may only insert
-- their OWN message, as themselves. Agent messages
-- come only from the server.
--
-- Replaces just the INSERT rule on messages, by
-- whatever it is named. Read, edit and delete are
-- left as they are.
--
-- Run this once in the Supabase SQL editor, after
-- deploying the matching app. Safe to re-run.
--

do $$
declare pol record;
begin
  for pol in
    select policyname
      from pg_policies
     where schemaname = 'public'
       and tablename = 'messages'
       and cmd = 'INSERT'
  loop
    execute format(
      'drop policy if exists %I on public.messages',
      pol.policyname
    );
  end loop;
end $$;

create policy "Post your own messages"
  on public.messages
  for insert
  to authenticated
  with check (
    role = 'user'
    and user_id = auth.uid()
    and public.is_project_member(project_id)
  );

notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 0027_drop_team_plus.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- ==========================================
-- TWO PLANS: FREE AND TEAM
-- ==========================================
--
-- Team+ is retired. Team now includes everything
-- that was split across Team and Team+ (own keys,
-- a shared key with a spend report, connected
-- apps, any MCP server by address, more scheduled
-- agents). Anyone who was on 'team_plus' becomes
-- 'team', and the plan check no longer allows
-- 'team_plus'.
--
-- Run this once in the Supabase SQL editor. Safe
-- to run more than once.
--

do $$
begin
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'public'
       and table_name = 'subscriptions'
  ) then
    update public.subscriptions
       set plan = 'team'
     where plan = 'team_plus';

    alter table public.subscriptions
      drop constraint if exists subscriptions_plan_check;

    alter table public.subscriptions
      drop constraint if exists subscriptions_plan_check_v2;

    alter table public.subscriptions
      add constraint subscriptions_plan_check_v2
      check (plan in ('free', 'team'));
  end if;
end $$;

notify pgrst, 'reload schema';


-- ==========================================
-- SEMANTIC MEMORY: EMBEDDINGS FOR FACTS
-- ==========================================
--
-- Until now every remembered fact for a scope was
-- injected into the prompt, newest first. As memory
-- grows that is a lot of tokens, most of them not
-- relevant to what was just asked - and on a model
-- capped by tokens-per-minute (Groq) it is the
-- difference between fitting and being refused.
--
-- This gives each fact a vector, so the prompt can
-- carry the handful of facts closest to the current
-- message instead of the newest ones. The vector is
-- produced by a small local model (nomic-embed-text,
-- 768 dimensions); the column width must match it.
--
-- Falls back on its own: a fact with no vector yet,
-- or a server with no embedder, still surfaces by
-- recency (the app tops up from recent facts).
--
-- Run this once in the Supabase SQL editor. Safe to
-- run more than once. Needs the pgvector extension,
-- which Supabase ships - this enables it.
--

create extension if not exists vector;


alter table public.memory_facts
  add column if not exists embedding vector(768);


-- Cosine distance, since the embeddings are compared
-- by direction. ivfflat is enough at this scale and
-- needs no tuning.

create index if not exists memory_facts_embedding_idx
  on public.memory_facts
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);


-- Top matching facts for one scope. SECURITY INVOKER
-- (the default), so the caller's row-level security
-- on memory_facts still applies - a member only ever
-- matches facts in projects they belong to. The
-- scope filter mirrors the app's: a project-level
-- fact has a null channel_id, matched with a null
-- p_channel_id.

create or replace function public.match_memory_facts(
  query_embedding vector(768),
  p_project_id uuid,
  p_channel_id uuid,
  match_count int
)
returns table (
  id uuid,
  content text,
  source text,
  created_at timestamptz,
  similarity float
)
language sql
stable
as $$
  select
    f.id,
    f.content,
    f.source,
    f.created_at,
    1 - (f.embedding <=> query_embedding) as similarity
  from public.memory_facts f
  where f.embedding is not null
    and f.project_id is not distinct from p_project_id
    and f.channel_id is not distinct from p_channel_id
  order by f.embedding <=> query_embedding
  limit match_count;
$$;


notify pgrst, 'reload schema';


-- ==========================================
-- PER-PROJECT PLANS, AND AN ADMIN ROLE
-- ==========================================
--
-- Pricing is "the project goes Team": you upgrade
-- a project, its owner pays, and everyone in it
-- gets the plan. Until now the plan lived on the
-- person (public.subscriptions), so we could not
-- say which project was paid for or bill two of a
-- person's projects differently.
--
-- This adds public.project_subscriptions: one row
-- per upgraded project, naming the project, its
-- owner (who pays), the plan, and how many members
-- it covers. No row means Free. The per-person
-- table stays for personal, project-less use.
--
-- It also gives project_members a third role,
-- 'admin', between owner and member: an admin runs
-- the project (members, settings, connections) but
-- does not control billing or delete it.
--
-- Run this once in the Supabase SQL editor. Safe to
-- run more than once.
--


-- ------------------------------------------
-- THE THIRD ROLE
-- ------------------------------------------

alter table public.project_members
  drop constraint if exists project_members_role_check;

alter table public.project_members
  add constraint project_members_role_check
  check (role in ('owner', 'admin', 'member'));


-- ------------------------------------------
-- PER-PROJECT SUBSCRIPTION
-- ------------------------------------------

create table if not exists public.project_subscriptions (
  project_id uuid primary key
    references public.projects (id)
    on delete cascade,

  -- Who pays. The project's owner at the time it
  -- was upgraded; kept explicit for billing.
  owner_id uuid not null
    references auth.users (id)
    on delete cascade,

  plan text not null default 'team'
    check (plan in ('free', 'team')),

  -- How many people the price covers, and how many
  -- extra seats were paid on top.
  included_members int not null default 5,
  extra_members int not null default 0,

  -- When the paid period ends. Null means it does
  -- not (a plan set by hand).
  current_period_end timestamptz,

  -- Filled in when a real payment provider is
  -- connected. Kept here so one row tells the whole
  -- billing story for a project.
  provider text,
  provider_subscription_id text,
  provider_customer_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists
  project_subscriptions_owner_idx
  on public.project_subscriptions (owner_id);


alter table public.project_subscriptions
  enable row level security;


-- Everyone in a project may see its plan (the
-- settings panel shows it). Nobody may change it
-- from a browser: upgrades and downgrades happen
-- server-side with the service role, so there is
-- deliberately no insert/update/delete policy here.

drop policy if exists
  "Members read their project's plan"
  on public.project_subscriptions;

create policy "Members read their project's plan"
  on public.project_subscriptions
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = project_subscriptions.project_id
         and pm.user_id = auth.uid()
    )
  );


-- ------------------------------------------
-- WHO MAY RUN THE PROJECT
-- ------------------------------------------
--
-- Owner or admin. SECURITY DEFINER so a policy can
-- call it without recursing through the table's own
-- row-level security.

create or replace function public.is_project_admin(
  p_project_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
      from public.project_members pm
     where pm.project_id = p_project_id
       and pm.user_id = auth.uid()
       and pm.role in ('owner', 'admin')
  );
$$;


-- ------------------------------------------
-- CARRY OVER WHAT IS ALREADY PAID
-- ------------------------------------------
--
-- Any project whose owner is on a Team plan today
-- (the old per-person way) becomes a Team project,
-- so nobody loses what they had. Projects on Free
-- get no row and stay Free.

insert into public.project_subscriptions
  (project_id, owner_id, plan, current_period_end)
select
  pm.project_id,
  pm.user_id,
  'team',
  s.current_period_end
from public.project_members pm
join public.subscriptions s
  on s.user_id = pm.user_id
where pm.role = 'owner'
  and s.plan = 'team'
  and (
    s.current_period_end is null
    or s.current_period_end > now()
  )
on conflict (project_id) do nothing;


notify pgrst, 'reload schema';


-- ==========================================
-- RENEWAL REMINDERS
-- ==========================================
--
-- Two columns so the worker can remind a project's
-- owner before Team lapses without nagging:
--
--   reminder_sent_at  when the last reminder went
--                     out, so one period gets one
--   shown_currency    the currency the owner saw,
--                     so the reminder can quote the
--                     right rupee price to renew
--
-- Run this once in the Supabase SQL editor. Safe to
-- run more than once.
--

alter table public.project_subscriptions
  add column if not exists reminder_sent_at timestamptz;

alter table public.project_subscriptions
  add column if not exists shown_currency text;

notify pgrst, 'reload schema';


-- ==========================================
-- ENCRYPT WHAT THE AGENT REMEMBERS
-- ==========================================
--
-- API keys and tokens have been sealed at rest for a
-- while (lib/crypto/secrets.ts). This extends the same
-- AES-256-GCM sealing to the most private free text the
-- app stores: the durable facts the agent remembers
-- about a project and its people, and the rolling
-- summary of older conversation.
--
-- Nothing in the app reads these columns from the
-- browser - they are assembled into the prompt on the
-- server and returned already decrypted - so sealing
-- them breaks no feature. A leaked backup or a stolen
-- service key then holds ciphertext, and the key that
-- opens it lives only in the server's environment.
--
-- The catch: a unique index cannot dedupe an encrypted
-- column, because every seal uses a fresh IV. So the
-- fact's uniqueness moves onto a keyed fingerprint of
-- its plaintext (content_hash, an HMAC the app writes),
-- and the old content-based unique indexes are dropped.
--
-- Order of operations:
--   1. Run this once in the Supabase SQL editor.
--   2. Deploy the code that seals on write / opens on read.
--   3. Run  npm run memory:seal -- --write  to seal the
--      facts and summaries already stored in the clear.
-- Safe to run more than once.
--

-- The fingerprint the unique indexes now key on. Null
-- for rows written before this migration; the backfill
-- fills them, and Postgres treats nulls as distinct so
-- they do not collide in the meantime.

alter table public.memory_facts
  add column if not exists content_hash text;


-- Off with the old uniqueness on the (soon encrypted)
-- content column, on with the same uniqueness keyed on
-- the fingerprint instead. Same scoping as before: a
-- channel fact is unique within its channel, a
-- project-wide fact (null channel) within its project.

drop index if exists public.memory_facts_channel_key;
drop index if exists public.memory_facts_project_key;

create unique index if not exists memory_facts_channel_hash_key
  on public.memory_facts (project_id, channel_id, content_hash)
  where channel_id is not null;

create unique index if not exists memory_facts_project_hash_key
  on public.memory_facts (project_id, content_hash)
  where channel_id is null;


notify pgrst, 'reload schema';


-- ==========================================
-- WHICH MESSAGE A REPLY ANSWERS
-- ==========================================
--
-- In a shared channel several people talk to the agent
-- at once, and replies stream back in whatever order
-- they finish - a quick "hi" is answered before a long
-- "write me an essay". Without a link, you cannot tell
-- which reply answers which message.
--
-- This adds reply_to: the message a reply answers. The
-- app fills it when it saves an agent reply, and the UI
-- shows "replying to …" above a reply so the thread is
-- readable however the messages are ordered.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
--

alter table public.messages
  add column if not exists reply_to uuid
    references public.messages (id)
    on delete set null;

notify pgrst, 'reload schema';


-- ==========================================
-- COMING-BACK NUDGE
-- ==========================================
--
-- One column so the worker can email someone who
-- signed up, looked once, and never came back -
-- and email them only once, ever.
--
--   winback_sent_at  when that one nudge went out.
--                    Null means it has not, so they
--                    are still a candidate; set means
--                    leave them alone.
--
-- Signup time and whether they returned both live on
-- auth.users (created_at, last_sign_in_at), which the
-- worker reads with the service role. This is just the
-- "already nudged" mark, kept next to the person.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
--

alter table public.profiles
  add column if not exists winback_sent_at timestamptz;

notify pgrst, 'reload schema';
