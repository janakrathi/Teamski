-- ==========================================
-- AGENTS ON A SCHEDULE
-- ==========================================
--
-- "Every Monday at 9, summarise last week in
-- #general." A schedule belongs to a channel and
-- runs that channel's agent. The worker looks for
-- schedules that are due, moves each one's next
-- time forward, and queues an ordinary agent run -
-- so a scheduled run can be watched, paused and
-- stopped like any other. Its answer is posted in
-- the channel.
--
-- The next time is worked out by the worker in the
-- schedule's own timezone (lib/agents/schedule.ts)
-- and stored, so "what is due" is one indexed
-- query.
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--

create table if not exists public.agent_schedules (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id)
    on delete cascade,

  channel_id uuid not null
    references public.channels (id)
    on delete cascade,

  -- Whose allowance and connected apps the runs
  -- use. Left null if they delete their account;
  -- the worker then turns the schedule off.
  created_by uuid
    references auth.users (id)
    on delete set null,

  title text not null default 'Scheduled task'
    check (char_length(title) between 1 and 80),

  task text not null
    check (char_length(task) between 1 and 2000),

  cadence text not null
    check (cadence in ('daily', 'weekdays', 'weekly', 'monthly')),

  time_of_day text not null
    check (time_of_day ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),

  weekday smallint check (weekday between 0 and 6),

  month_day smallint check (month_day between 1 and 28),

  timezone text not null default 'Asia/Kolkata',

  enabled boolean not null default true,

  next_run_at timestamptz not null,

  last_run_at timestamptz,

  last_run_id uuid
    references public.agent_runs (id)
    on delete set null,

  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_schedules_due_idx
  on public.agent_schedules (next_run_at)
  where enabled;

create index if not exists agent_schedules_channel_idx
  on public.agent_schedules (channel_id);


-- Which schedule started a run, so its answer can
-- be posted in the channel when it finishes.

alter table public.agent_runs
  add column if not exists schedule_id uuid
    references public.agent_schedules (id)
    on delete set null;


alter table public.agent_schedules enable row level security;

-- Everyone in the project can see what is
-- scheduled in it.

drop policy if exists "Project members read schedules"
  on public.agent_schedules;

create policy "Project members read schedules"
  on public.agent_schedules
  for select
  using (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = agent_schedules.project_id
         and pm.user_id = auth.uid()
    )
  );

-- Any member can add one, as themselves.

drop policy if exists "Project members add schedules"
  on public.agent_schedules;

create policy "Project members add schedules"
  on public.agent_schedules
  for insert
  with check (
    created_by = auth.uid()
    and exists (
      select 1
        from public.project_members pm
       where pm.project_id = agent_schedules.project_id
         and pm.user_id = auth.uid()
    )
  );

-- Whoever made it, or an owner of the project, can
-- change or remove it.

drop policy if exists "Creators and owners change schedules"
  on public.agent_schedules;

create policy "Creators and owners change schedules"
  on public.agent_schedules
  for update
  using (
    created_by = auth.uid()
    or exists (
      select 1
        from public.project_members pm
       where pm.project_id = agent_schedules.project_id
         and pm.user_id = auth.uid()
         and pm.role = 'owner'
    )
  );

drop policy if exists "Creators and owners remove schedules"
  on public.agent_schedules;

create policy "Creators and owners remove schedules"
  on public.agent_schedules
  for delete
  using (
    created_by = auth.uid()
    or exists (
      select 1
        from public.project_members pm
       where pm.project_id = agent_schedules.project_id
         and pm.user_id = auth.uid()
         and pm.role = 'owner'
    )
  );


-- ==========================================
-- A NEW CHANNEL FOLLOWS YOUR MODEL
-- ==========================================
--
-- agents.model was required and defaulted to a
-- local model, so every new channel was pinned to
-- it - and a channel's model wins over the one
-- each person picked, so connecting Gemini did not
-- change what a new channel answered with. Empty
-- now means "whatever the person asking has
-- chosen". Channels someone has set keep theirs.

alter table public.agents
  alter column model drop not null;

alter table public.agents
  alter column model drop default;

notify pgrst, 'reload schema';
