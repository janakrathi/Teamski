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
