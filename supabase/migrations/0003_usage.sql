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
