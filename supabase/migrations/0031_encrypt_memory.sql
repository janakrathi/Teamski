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
