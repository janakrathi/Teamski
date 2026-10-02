-- ==========================================
-- RENEWAL REMINDERS
-- ==========================================
--
-- Two columns so the worker can remind a project's
-- owner before Team lapses without nagging:
--
--   reminder_sent_at  when the last reminder went
--                     out, so one period gets one
--   shown_currency    the currency the owner saw,
--                     so the reminder can quote the
--                     right rupee price to renew
--
-- Run this once in the Supabase SQL editor. Safe to
-- run more than once.
--

alter table public.project_subscriptions
  add column if not exists reminder_sent_at timestamptz;

alter table public.project_subscriptions
  add column if not exists shown_currency text;

notify pgrst, 'reload schema';
