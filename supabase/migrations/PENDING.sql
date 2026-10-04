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


-- ==========================================
-- COMING-BACK NUDGE
-- ==========================================
--
-- One column so the worker can email someone who
-- signed up, looked once, and never came back -
-- and email them only once, ever.
--
--   winback_sent_at  when that one nudge went out.
--                    Null means it has not, so they
--                    are still a candidate; set means
--                    leave them alone.
--
-- Signup time and whether they returned both live on
-- auth.users (created_at, last_sign_in_at), which the
-- worker reads with the service role. This is just the
-- "already nudged" mark, kept next to the person.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
--

alter table public.profiles
  add column if not exists winback_sent_at timestamptz;

notify pgrst, 'reload schema';


-- ==========================================
-- VIEWERS, PRIVATE CHANNELS, AUDIT LOG, SKILLS
-- ==========================================
--
-- 1. A fourth role, 'viewer': reads the channels it is
--    allowed into and nothing else - no posting, no
--    agents, no uploads, no new channels.
--
-- 2. Private channels. A channel is open to everyone in
--    the project (as now) or restricted to the people
--    listed in channel_members. Owners and admins see
--    every channel; a viewer sees only the channels they
--    are listed on. Messages, files, memory, agents and
--    runs follow the channel they belong to.
--
-- 3. An audit log of who changed what in a project,
--    readable by its owner and admins. Written by the
--    server only.
--
-- 4. Project skills: instructions (a SKILL.md) brought
--    in from a GitHub repo, which the agent loads when a
--    task calls for one, on any model.
--
-- Run this once in the Supabase SQL editor. Safe to run
-- more than once.
--


-- ------------------------------------------
-- 1. THE VIEWER ROLE
-- ------------------------------------------

alter table public.project_members
  drop constraint if exists project_members_role_check;

alter table public.project_members
  add constraint project_members_role_check
  check (role in ('owner', 'admin', 'member', 'viewer'));


-- In the project, and allowed to change things in it:
-- anyone but a viewer.

create or replace function public.is_project_contributor(
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
       and pm.role <> 'viewer'
  );
$$;


-- ------------------------------------------
-- 2. PRIVATE CHANNELS
-- ------------------------------------------

alter table public.channels
  add column if not exists restricted boolean not null default false;

create table if not exists public.channel_members (
  channel_id uuid not null
    references public.channels (id)
    on delete cascade,

  user_id uuid not null
    references auth.users (id)
    on delete cascade,

  added_by uuid
    references auth.users (id)
    on delete set null,

  created_at timestamptz not null default now(),

  primary key (channel_id, user_id)
);

create index if not exists channel_members_user_idx
  on public.channel_members (user_id);


-- May the signed-in person see this channel? In its
-- project, and one of: they run the project; they are
-- listed on the channel; or it is open and they are not
-- a viewer. A viewer sees only the channels they were
-- given. SECURITY DEFINER so policies can call it
-- without recursing.

create or replace function public.can_view_channel(
  p_channel_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
      from public.channels c
      join public.project_members pm
        on pm.project_id = c.project_id
       and pm.user_id = auth.uid()
     where c.id = p_channel_id
       and (
         (not c.restricted and pm.role <> 'viewer')
         or pm.role in ('owner', 'admin')
         or exists (
           select 1
             from public.channel_members cm
            where cm.channel_id = c.id
              and cm.user_id = auth.uid()
         )
       )
  );
$$;


-- May they post in it? Seeing it, and not a viewer.

create or replace function public.can_post_channel(
  p_channel_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.can_view_channel(p_channel_id)
     and exists (
       select 1
         from public.channels c
         join public.project_members pm
           on pm.project_id = c.project_id
          and pm.user_id = auth.uid()
        where c.id = p_channel_id
          and pm.role <> 'viewer'
     );
$$;


-- A file the person may not see, because it belongs to a
-- private channel they are not in. For the storage
-- policy, which cannot read attachments through their
-- own row-level security.

create or replace function public.attachment_hidden(
  p_path text
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
      from public.attachments a
     where a.storage_path = p_path
       and a.channel_id is not null
       and not public.can_view_channel(a.channel_id)
  );
$$;

grant execute on function public.is_project_contributor(uuid) to authenticated;
grant execute on function public.can_view_channel(uuid) to authenticated;
grant execute on function public.can_post_channel(uuid) to authenticated;
grant execute on function public.attachment_hidden(text) to authenticated;


-- Who is in a private channel: visible to the people who
-- can see the channel. Changed only by the server (the
-- channel access route checks who may).

alter table public.channel_members enable row level security;

drop policy if exists "See who is in channels you can see"
  on public.channel_members;

create policy "See who is in channels you can see"
  on public.channel_members
  for select
  to authenticated
  using (public.can_view_channel(channel_id));

grant select on public.channel_members to authenticated;
grant all privileges on public.channel_members to service_role;


-- Only an owner or admin makes a channel private or open
-- again from a browser; the server (service role, no
-- auth.uid()) may, after its own check.

create or replace function public.guard_channel_restricted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.restricted and not public.is_project_admin(new.project_id) then
      raise exception 'Only an owner or admin can make a channel private.';
    end if;
  elsif new.restricted is distinct from old.restricted
    and not public.is_project_admin(new.project_id) then
    raise exception 'Only an owner or admin can change who sees a channel.';
  end if;

  return new;
end;
$$;

drop trigger if exists channels_guard_restricted on public.channels;

create trigger channels_guard_restricted
  before insert or update on public.channels
  for each row execute function public.guard_channel_restricted();


-- Every policy on channels, messages and the rest is
-- replaced, by whatever name it had, with one that knows
-- about private channels and viewers.

do $$
declare pol record;
begin
  for pol in
    select tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and (
         tablename = 'channels'
         or (tablename = 'messages' and cmd in ('SELECT', 'INSERT', 'DELETE'))
       )
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;


-- CHANNELS

create policy "See channels you are allowed in"
  on public.channels
  for select
  to authenticated
  using (public.can_view_channel(id));

create policy "Contributors create channels"
  on public.channels
  for insert
  to authenticated
  with check (public.is_project_contributor(project_id));

create policy "Contributors rename channels they see"
  on public.channels
  for update
  to authenticated
  using (public.can_post_channel(id))
  with check (public.is_project_contributor(project_id));

create policy "Contributors delete channels they see"
  on public.channels
  for delete
  to authenticated
  using (public.can_post_channel(id));


-- MESSAGES

create policy "Read messages in channels you can see"
  on public.messages
  for select
  to authenticated
  using (
    public.is_project_member(project_id)
    and (channel_id is null or public.can_view_channel(channel_id))
  );

create policy "Post your own messages"
  on public.messages
  for insert
  to authenticated
  with check (
    role = 'user'
    and user_id = auth.uid()
    and public.is_project_contributor(project_id)
    and (channel_id is null or public.can_post_channel(channel_id))
  );

create policy "Delete your own, or the agent's"
  on public.messages
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    or (
      user_id is null
      and public.is_project_contributor(project_id)
      and (channel_id is null or public.can_view_channel(channel_id))
    )
  );


-- ATTACHMENTS (project ones; the DM policies stay)

drop policy if exists "Project members read attachments" on public.attachments;
drop policy if exists "Project members add attachments" on public.attachments;
drop policy if exists "Project members update attachments" on public.attachments;
drop policy if exists "Project members delete attachments" on public.attachments;

create policy "Project members read attachments"
  on public.attachments
  for select
  to authenticated
  using (
    project_id is not null
    and public.is_project_member(project_id)
    and (channel_id is null or public.can_view_channel(channel_id))
  );

create policy "Project members add attachments"
  on public.attachments
  for insert
  to authenticated
  with check (
    project_id is not null
    and public.is_project_contributor(project_id)
    and (channel_id is null or public.can_post_channel(channel_id))
  );

create policy "Project members update attachments"
  on public.attachments
  for update
  to authenticated
  using (
    project_id is not null
    and public.is_project_contributor(project_id)
    and (channel_id is null or public.can_view_channel(channel_id))
  );

create policy "Project members delete attachments"
  on public.attachments
  for delete
  to authenticated
  using (
    project_id is not null
    and public.is_project_contributor(project_id)
    and (channel_id is null or public.can_view_channel(channel_id))
  );


-- The files themselves.

drop policy if exists "Project members read attachment files" on storage.objects;
drop policy if exists "Project members upload attachment files" on storage.objects;
drop policy if exists "Project members delete attachment files" on storage.objects;

create policy "Project members read attachment files"
  on storage.objects
  for select
  using (
    bucket_id = 'attachments'
    and exists (
      select 1
        from public.project_members pm
       where pm.user_id = auth.uid()
         and pm.project_id::text = (storage.foldername(name))[1]
    )
    and not public.attachment_hidden(name)
  );

create policy "Project members upload attachment files"
  on storage.objects
  for insert
  with check (
    bucket_id = 'attachments'
    and exists (
      select 1
        from public.project_members pm
       where pm.user_id = auth.uid()
         and pm.role <> 'viewer'
         and pm.project_id::text = (storage.foldername(name))[1]
    )
  );

create policy "Project members delete attachment files"
  on storage.objects
  for delete
  using (
    bucket_id = 'attachments'
    and exists (
      select 1
        from public.project_members pm
       where pm.user_id = auth.uid()
         and pm.role <> 'viewer'
         and pm.project_id::text = (storage.foldername(name))[1]
    )
    and not public.attachment_hidden(name)
  );


-- MEMORY

drop policy if exists "Project members manage summaries" on public.conversation_summaries;
drop policy if exists "Read summaries you can see" on public.conversation_summaries;
drop policy if exists "Contributors write summaries" on public.conversation_summaries;

create policy "Read summaries you can see"
  on public.conversation_summaries
  for select
  to authenticated
  using (
    public.is_project_member(project_id)
    and (channel_id is null or public.can_view_channel(channel_id))
  );

create policy "Contributors write summaries"
  on public.conversation_summaries
  for all
  to authenticated
  using (
    public.is_project_contributor(project_id)
    and (channel_id is null or public.can_view_channel(channel_id))
  )
  with check (
    public.is_project_contributor(project_id)
    and (channel_id is null or public.can_view_channel(channel_id))
  );

drop policy if exists "Project members manage facts" on public.memory_facts;
drop policy if exists "Read facts you can see" on public.memory_facts;
drop policy if exists "Contributors write facts" on public.memory_facts;

create policy "Read facts you can see"
  on public.memory_facts
  for select
  to authenticated
  using (
    public.is_project_member(project_id)
    and (channel_id is null or public.can_view_channel(channel_id))
  );

create policy "Contributors write facts"
  on public.memory_facts
  for all
  to authenticated
  using (
    public.is_project_contributor(project_id)
    and (channel_id is null or public.can_view_channel(channel_id))
  )
  with check (
    public.is_project_contributor(project_id)
    and (channel_id is null or public.can_view_channel(channel_id))
  );


-- AGENTS, RUNS, EVENTS, SCHEDULES

drop policy if exists "Project members read agents" on public.agents;
drop policy if exists "Project members update agents" on public.agents;

create policy "Project members read agents"
  on public.agents
  for select
  to authenticated
  using (
    public.is_project_member(project_id)
    and (channel_id is null or public.can_view_channel(channel_id))
  );

create policy "Project members update agents"
  on public.agents
  for update
  to authenticated
  using (
    public.is_project_contributor(project_id)
    and (channel_id is null or public.can_view_channel(channel_id))
  );

drop policy if exists "Project members read agent events" on public.agent_events;

create policy "Project members read agent events"
  on public.agent_events
  for select
  to authenticated
  using (
    public.is_project_member(project_id)
    and exists (
      select 1 from public.agents a where a.id = agent_events.agent_id
    )
  );

drop policy if exists "Project members read runs" on public.agent_runs;
drop policy if exists "Project members start runs" on public.agent_runs;
drop policy if exists "Project members control runs" on public.agent_runs;

create policy "Project members read runs"
  on public.agent_runs
  for select
  to authenticated
  using (
    public.is_project_member(project_id)
    and (channel_id is null or public.can_view_channel(channel_id))
  );

create policy "Project members start runs"
  on public.agent_runs
  for insert
  to authenticated
  with check (
    public.is_project_contributor(project_id)
    and (channel_id is null or public.can_post_channel(channel_id))
  );

create policy "Project members control runs"
  on public.agent_runs
  for update
  to authenticated
  using (
    public.is_project_contributor(project_id)
    and (channel_id is null or public.can_view_channel(channel_id))
  );

drop policy if exists "Project members read schedules" on public.agent_schedules;
drop policy if exists "Project members add schedules" on public.agent_schedules;

create policy "Project members read schedules"
  on public.agent_schedules
  for select
  to authenticated
  using (
    public.is_project_member(project_id)
    and (channel_id is null or public.can_view_channel(channel_id))
  );

create policy "Project members add schedules"
  on public.agent_schedules
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.is_project_contributor(project_id)
    and (channel_id is null or public.can_post_channel(channel_id))
  );


-- MEMBERS AND INVITES: an owner or admin adds members or
-- viewers, never owners.

do $$
declare pol record;
begin
  for pol in
    select policyname
      from pg_policies
     where schemaname = 'public'
       and tablename = 'project_members'
       and cmd = 'INSERT'
  loop
    execute format('drop policy if exists %I on public.project_members', pol.policyname);
  end loop;
end $$;

create policy "Admins add members and viewers"
  on public.project_members
  for insert
  to authenticated
  with check (
    role in ('member', 'viewer')
    and public.is_project_admin(project_id)
  );

drop policy if exists "Members send member invites" on public.project_invites;
drop policy if exists "Members update invites" on public.project_invites;
drop policy if exists "Admins send invites" on public.project_invites;
drop policy if exists "Admins update invites" on public.project_invites;

create policy "Admins send invites"
  on public.project_invites
  for insert
  to authenticated
  with check (
    coalesce(role, 'member') in ('member', 'viewer')
    and public.is_project_admin(project_id)
  );

create policy "Admins update invites"
  on public.project_invites
  for update
  to authenticated
  using (public.is_project_admin(project_id))
  with check (
    coalesce(role, 'member') in ('member', 'viewer')
    and public.is_project_admin(project_id)
  );


-- ------------------------------------------
-- 3. AUDIT LOG
-- ------------------------------------------

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,

  project_id uuid not null
    references public.projects (id)
    on delete cascade,

  -- Who did it. Null when the system did.
  actor_id uuid
    references auth.users (id)
    on delete set null,

  -- What happened, e.g. 'member.role', 'channel.access'.
  action text not null,

  -- What it happened to, in words ("@riya", "#design").
  target text,

  details jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists audit_log_project_idx
  on public.audit_log (project_id, created_at desc);

alter table public.audit_log enable row level security;

drop policy if exists "Owners and admins read the audit log" on public.audit_log;

create policy "Owners and admins read the audit log"
  on public.audit_log
  for select
  to authenticated
  using (public.is_project_admin(project_id));

grant select on public.audit_log to authenticated;
grant all privileges on public.audit_log to service_role;


-- ------------------------------------------
-- 4. PROJECT SKILLS
-- ------------------------------------------

create table if not exists public.project_skills (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id)
    on delete cascade,

  -- From the SKILL.md front matter.
  name text not null,
  description text not null default '',

  -- The instructions themselves, loaded when used.
  body text not null,

  -- Where it came from: the GitHub page of the
  -- SKILL.md, so it can be refreshed.
  source text,

  enabled boolean not null default true,

  added_by uuid
    references auth.users (id)
    on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (project_id, name)
);

alter table public.project_skills enable row level security;

drop policy if exists "Members read their project's skills" on public.project_skills;

create policy "Members read their project's skills"
  on public.project_skills
  for select
  to authenticated
  using (public.is_project_member(project_id));

grant select on public.project_skills to authenticated;
grant all privileges on public.project_skills to service_role;


notify pgrst, 'reload schema';


-- ==========================================
-- VIEWERS SEE OPEN CHANNELS
-- ==========================================
--
-- 0034 had a viewer see only the channels they were
-- ticked on, even open ones. Now an open channel is
-- open to everyone in the project, viewers included
-- (they read it; they still cannot post). A private
-- channel is still only for the people ticked on it,
-- plus owners and admins.
--
-- Run this once in the Supabase SQL editor, after 0034.
-- Safe to run more than once.
--

create or replace function public.can_view_channel(
  p_channel_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
      from public.channels c
      join public.project_members pm
        on pm.project_id = c.project_id
       and pm.user_id = auth.uid()
     where c.id = p_channel_id
       and (
         not c.restricted
         or pm.role in ('owner', 'admin')
         or exists (
           select 1
             from public.channel_members cm
            where cm.channel_id = c.id
              and cm.user_id = auth.uid()
         )
       )
  );
$$;

notify pgrst, 'reload schema';


-- ==========================================
-- WHICH MODEL WROTE A REPLY
-- ==========================================
--
-- An agent reply is labelled with the model that wrote
-- it ("GPT-OSS 120B", "Qwen3.8 27B") instead of "Agent".
-- The app fills this when it saves a reply - including
-- the model that took over when the first one hit its
-- limit. Replies saved before this stay "Agent".
--
-- Run once in the Supabase SQL editor. Safe to re-run.
--

alter table public.messages
  add column if not exists model text;

notify pgrst, 'reload schema';
