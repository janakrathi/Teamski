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
