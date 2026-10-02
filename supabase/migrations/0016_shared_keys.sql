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
