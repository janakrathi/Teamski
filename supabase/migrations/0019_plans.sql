-- ==========================================
-- PLANS
-- ==========================================
--
-- Which plan each person is on. Free is the
-- built-in model; bringing your own API key needs
-- Pro or Team; sharing a key with a whole project
-- needs the owner to be on Team.
--
-- People can read their own row and write
-- nothing. Only the server (payments, later) or
-- you in this editor can change a plan, so nobody
-- upgrades themselves from the browser.
--
-- Until payments exist, set a plan by hand:
--
--   insert into public.subscriptions (user_id, plan)
--   select id, 'pro' from auth.users
--    where email = 'someone@example.com'
--   on conflict (user_id)
--   do update set plan = excluded.plan,
--                 updated_at = now();
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--

create table if not exists public.subscriptions (
  user_id uuid primary key
    references auth.users (id)
    on delete cascade,

  plan text not null default 'free'
    check (plan in ('free', 'pro', 'team')),

  -- When a paid plan runs out. Null means it does
  -- not, which is what a plan set by hand wants.
  current_period_end timestamptz,

  updated_at timestamptz not null default now()
);

alter table public.subscriptions
  enable row level security;

drop policy if exists
  "People read their own plan"
  on public.subscriptions;

create policy "People read their own plan"
  on public.subscriptions
  for select
  using (user_id = auth.uid());
