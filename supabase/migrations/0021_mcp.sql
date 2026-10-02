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
