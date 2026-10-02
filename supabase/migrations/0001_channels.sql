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
