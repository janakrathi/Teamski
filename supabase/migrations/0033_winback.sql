-- ==========================================
-- COMING-BACK NUDGE
-- ==========================================
--
-- One column so the worker can email someone who
-- signed up, looked once, and never came back -
-- and email them only once, ever.
--
--   winback_sent_at  when that one nudge went out.
--                    Null means it has not, so they
--                    are still a candidate; set means
--                    leave them alone.
--
-- Signup time and whether they returned both live on
-- auth.users (created_at, last_sign_in_at), which the
-- worker reads with the service role. This is just the
-- "already nudged" mark, kept next to the person.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
--

alter table public.profiles
  add column if not exists winback_sent_at timestamptz;

notify pgrst, 'reload schema';
