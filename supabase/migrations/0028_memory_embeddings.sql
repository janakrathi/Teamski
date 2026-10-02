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
