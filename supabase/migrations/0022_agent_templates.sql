-- ==========================================
-- WHICH TEMPLATE AN AGENT STARTED FROM
-- ==========================================
--
-- A channel made from "Meeting notes" should
-- offer meeting-notes first messages when it is
-- empty. The instructions themselves are copied
-- onto the agent and can be edited freely; this
-- only remembers where they came from.
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--

alter table public.agents
  add column if not exists template_id text;
