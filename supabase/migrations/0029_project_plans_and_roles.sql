-- ==========================================
-- PER-PROJECT PLANS, AND AN ADMIN ROLE
-- ==========================================
--
-- Pricing is "the project goes Team": you upgrade
-- a project, its owner pays, and everyone in it
-- gets the plan. Until now the plan lived on the
-- person (public.subscriptions), so we could not
-- say which project was paid for or bill two of a
-- person's projects differently.
--
-- This adds public.project_subscriptions: one row
-- per upgraded project, naming the project, its
-- owner (who pays), the plan, and how many members
-- it covers. No row means Free. The per-person
-- table stays for personal, project-less use.
--
-- It also gives project_members a third role,
-- 'admin', between owner and member: an admin runs
-- the project (members, settings, connections) but
-- does not control billing or delete it.
--
-- Run this once in the Supabase SQL editor. Safe to
-- run more than once.
--


-- ------------------------------------------
-- THE THIRD ROLE
-- ------------------------------------------

alter table public.project_members
  drop constraint if exists project_members_role_check;

alter table public.project_members
  add constraint project_members_role_check
  check (role in ('owner', 'admin', 'member'));


-- ------------------------------------------
-- PER-PROJECT SUBSCRIPTION
-- ------------------------------------------

create table if not exists public.project_subscriptions (
  project_id uuid primary key
    references public.projects (id)
    on delete cascade,

  -- Who pays. The project's owner at the time it
  -- was upgraded; kept explicit for billing.
  owner_id uuid not null
    references auth.users (id)
    on delete cascade,

  plan text not null default 'team'
    check (plan in ('free', 'team')),

  -- How many people the price covers, and how many
  -- extra seats were paid on top.
  included_members int not null default 5,
  extra_members int not null default 0,

  -- When the paid period ends. Null means it does
  -- not (a plan set by hand).
  current_period_end timestamptz,

  -- Filled in when a real payment provider is
  -- connected. Kept here so one row tells the whole
  -- billing story for a project.
  provider text,
  provider_subscription_id text,
  provider_customer_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists
  project_subscriptions_owner_idx
  on public.project_subscriptions (owner_id);


alter table public.project_subscriptions
  enable row level security;


-- Everyone in a project may see its plan (the
-- settings panel shows it). Nobody may change it
-- from a browser: upgrades and downgrades happen
-- server-side with the service role, so there is
-- deliberately no insert/update/delete policy here.

drop policy if exists
  "Members read their project's plan"
  on public.project_subscriptions;

create policy "Members read their project's plan"
  on public.project_subscriptions
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = project_subscriptions.project_id
         and pm.user_id = auth.uid()
    )
  );


-- ------------------------------------------
-- WHO MAY RUN THE PROJECT
-- ------------------------------------------
--
-- Owner or admin. SECURITY DEFINER so a policy can
-- call it without recursing through the table's own
-- row-level security.

create or replace function public.is_project_admin(
  p_project_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
      from public.project_members pm
     where pm.project_id = p_project_id
       and pm.user_id = auth.uid()
       and pm.role in ('owner', 'admin')
  );
$$;


-- ------------------------------------------
-- CARRY OVER WHAT IS ALREADY PAID
-- ------------------------------------------
--
-- Any project whose owner is on a Team plan today
-- (the old per-person way) becomes a Team project,
-- so nobody loses what they had. Projects on Free
-- get no row and stay Free.

insert into public.project_subscriptions
  (project_id, owner_id, plan, current_period_end)
select
  pm.project_id,
  pm.user_id,
  'team',
  s.current_period_end
from public.project_members pm
join public.subscriptions s
  on s.user_id = pm.user_id
where pm.role = 'owner'
  and s.plan = 'team'
  and (
    s.current_period_end is null
    or s.current_period_end > now()
  )
on conflict (project_id) do nothing;


notify pgrst, 'reload schema';
