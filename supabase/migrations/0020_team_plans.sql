-- ==========================================
-- FREE, TEAM, TEAM+
-- ==========================================
--
-- Pro is gone. This is a team product, so plans
-- belong to the project owner and cover everyone
-- in their projects:
--
--   free       - basic built-in model, small
--                daily allowance
--   team       - stronger model, more messages,
--                API keys
--   team_plus  - best model, the most messages,
--                the spend report
--
-- Anyone set to 'pro' by hand becomes 'team', and
-- anyone on the old 'team' becomes 'team_plus', so
-- nobody loses what they had. That happens once:
-- the new constraint existing is the sign it has
-- already run.
--
-- Run this once in the Supabase SQL editor, after
-- 0019. It is safe to run more than once.
--

alter table public.subscriptions
  drop constraint if exists subscriptions_plan_check;

update public.subscriptions
   set plan = case plan
                when 'team' then 'team_plus'
                when 'pro'  then 'team'
              end,
       updated_at = now()
 where plan in ('pro', 'team')
   and not exists (
     select 1
       from pg_constraint
      where conname = 'subscriptions_plan_check_v2'
   );

alter table public.subscriptions
  drop constraint if exists subscriptions_plan_check_v2;

alter table public.subscriptions
  add constraint subscriptions_plan_check_v2
  check (plan in ('free', 'team', 'team_plus'));


-- Counting today's built-in messages is one
-- query per turn, by person and time.

create index if not exists
  usage_events_user_day_idx
  on public.usage_events
     (user_id, created_at desc);
