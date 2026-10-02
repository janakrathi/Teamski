-- ==========================================
-- TWO PLANS: FREE AND TEAM
-- ==========================================
--
-- Team+ is retired. Team now includes everything
-- that was split across Team and Team+ (own keys,
-- a shared key with a spend report, connected
-- apps, any MCP server by address, more scheduled
-- agents). Anyone who was on 'team_plus' becomes
-- 'team', and the plan check no longer allows
-- 'team_plus'.
--
-- Run this once in the Supabase SQL editor. Safe
-- to run more than once.
--

do $$
begin
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'public'
       and table_name = 'subscriptions'
  ) then
    update public.subscriptions
       set plan = 'team'
     where plan = 'team_plus';

    alter table public.subscriptions
      drop constraint if exists subscriptions_plan_check;

    alter table public.subscriptions
      drop constraint if exists subscriptions_plan_check_v2;

    alter table public.subscriptions
      add constraint subscriptions_plan_check_v2
      check (plan in ('free', 'team'));
  end if;
end $$;

notify pgrst, 'reload schema';
