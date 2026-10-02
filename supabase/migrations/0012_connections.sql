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
