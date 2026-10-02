-- ==========================================
-- WHICH MESSAGE A REPLY ANSWERS
-- ==========================================
--
-- In a shared channel several people talk to the agent
-- at once, and replies stream back in whatever order
-- they finish - a quick "hi" is answered before a long
-- "write me an essay". Without a link, you cannot tell
-- which reply answers which message.
--
-- This adds reply_to: the message a reply answers. The
-- app fills it when it saves an agent reply, and the UI
-- shows "replying to …" above a reply so the thread is
-- readable however the messages are ordered.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
--

alter table public.messages
  add column if not exists reply_to uuid
    references public.messages (id)
    on delete set null;

notify pgrst, 'reload schema';


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
