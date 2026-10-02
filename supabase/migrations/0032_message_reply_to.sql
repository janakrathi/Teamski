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
