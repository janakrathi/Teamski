-- ==========================================
-- LIVE AGENT ACTIVITY
-- ==========================================
--
-- The worker already records every step it takes
-- into agent_events. This makes those rows
-- readable by the people in the project and
-- pushes them out over realtime, so a background
-- agent can be watched instead of only inspected
-- afterwards in the database.
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--


-- ------------------------------------------
-- TABLE PRIVILEGES
-- ------------------------------------------
--
-- Row level security decides which rows a role
-- may see, but it cannot grant access to the
-- table in the first place. Supabase normally
-- sets these defaults up; they are missing here,
-- which is why the service role could not read
-- its own tables until they were granted.
--
-- Granting is idempotent, so this is safe even
-- where the privileges already exist.
--

grant usage on schema public
  to anon, authenticated, service_role;

grant select, insert, update, delete
  on all tables in schema public
  to authenticated;

grant select
  on all tables in schema public
  to anon;

grant all privileges
  on all tables in schema public
  to service_role;

grant usage, select
  on all sequences in schema public
  to anon, authenticated, service_role;

-- Make sure tables added later inherit the same
-- privileges rather than repeating this.

alter default privileges in schema public
  grant select, insert, update, delete
  on tables to authenticated;

alter default privileges in schema public
  grant select on tables to anon;

alter default privileges in schema public
  grant all on tables to service_role;


-- ------------------------------------------
-- READ POLICIES FOR AGENT TABLES
-- ------------------------------------------
--
-- Anyone in the project can watch its agents.
-- Writing stays with the worker, which uses the
-- service role and bypasses these.
--

alter table public.agent_events
  enable row level security;

drop policy if exists
  "Project members read agent events"
  on public.agent_events;

create policy "Project members read agent events"
  on public.agent_events
  for select
  using (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = agent_events.project_id
         and pm.user_id = auth.uid()
    )
  );


alter table public.agents
  enable row level security;

drop policy if exists
  "Project members read agents"
  on public.agents;

create policy "Project members read agents"
  on public.agents
  for select
  using (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = agents.project_id
         and pm.user_id = auth.uid()
    )
  );

drop policy if exists
  "Project members update agents"
  on public.agents;

create policy "Project members update agents"
  on public.agents
  for update
  using (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = agents.project_id
         and pm.user_id = auth.uid()
    )
  );


-- ------------------------------------------
-- REALTIME
-- ------------------------------------------
--
-- A table only streams changes to the browser
-- once it is in this publication. Adding one
-- twice is an error, so check first.
--

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'agent_events'
  ) then
    alter publication supabase_realtime
      add table public.agent_events;
  end if;

  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'agent_runs'
  ) then
    alter publication supabase_realtime
      add table public.agent_runs;
  end if;
end
$$;
