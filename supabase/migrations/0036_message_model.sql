-- ==========================================
-- WHICH MODEL WROTE A REPLY
-- ==========================================
--
-- An agent reply is labelled with the model that wrote
-- it ("GPT-OSS 120B", "Qwen3.8 27B") instead of "Agent".
-- The app fills this when it saves a reply - including
-- the model that took over when the first one hit its
-- limit. Replies saved before this stay "Agent".
--
-- Run once in the Supabase SQL editor. Safe to re-run.
--

alter table public.messages
  add column if not exists model text;

notify pgrst, 'reload schema';
