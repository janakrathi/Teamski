-- ==========================================
-- NOTIFICATIONS
-- ==========================================
--
-- The workspace is shared but silent: nothing
-- tells you a teammate wrote to you, mentioned
-- you, or that an agent you started has
-- finished. This is the table that says so.
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--

create extension if not exists "pgcrypto";


create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),

  -- Who should see it.
  user_id uuid not null
    references auth.users (id)
    on delete cascade,

  project_id uuid
    references public.projects (id)
    on delete cascade,

  channel_id uuid
    references public.channels (id)
    on delete cascade,

  message_id uuid
    references public.messages (id)
    on delete cascade,

  -- Who or what caused it. Null for the agent.
  actor_id uuid
    references auth.users (id)
    on delete set null,

  -- mention | dm | agent_done | agent_error
  kind text not null,

  title text not null,
  body text not null default '',

  read_at timestamptz,

  created_at timestamptz not null default now()
);

-- The common read is "my unread, newest first".

create index if not exists notifications_inbox_idx
  on public.notifications (user_id, read_at, created_at desc);


alter table public.notifications
  enable row level security;

-- You can only ever see your own.

drop policy if exists
  "Read own notifications"
  on public.notifications;

create policy "Read own notifications"
  on public.notifications
  for select
  using (user_id = auth.uid());

-- Marking read is the only change a person makes.

drop policy if exists
  "Update own notifications"
  on public.notifications;

create policy "Update own notifications"
  on public.notifications
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- A member of the project may notify another
-- member of it. The worker uses the service role
-- and bypasses this.

drop policy if exists
  "Notify project members"
  on public.notifications;

create policy "Notify project members"
  on public.notifications
  for insert
  with check (
    project_id is null
    or exists (
      select 1
        from public.project_members mine
       where mine.project_id = notifications.project_id
         and mine.user_id = auth.uid()
    )
  );


grant select, insert, update
  on public.notifications to authenticated;

grant all privileges
  on public.notifications to service_role;


-- Delivered to the browser as they are written,
-- so a mention lands without a refresh.

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'notifications'
  ) then
    alter publication supabase_realtime
      add table public.notifications;
  end if;
end
$$;
