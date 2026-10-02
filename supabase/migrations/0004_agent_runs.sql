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
