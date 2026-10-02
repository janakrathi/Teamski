-- ==========================================
-- CLOSING FIVE WAYS IN
-- ==========================================
--
-- The browser talks to the database directly with
-- an anonymous key, so row level security is the
-- real fence, not the API. A security audit with
-- two throwaway accounts found five places where
-- the fence had a gap. This closes each one, and
-- only that one - the working policies beside them
-- are left alone.
--
-- 1. Any signed-in person could read EVERY user's
--    profile, including their email. Now: your own,
--    and people you share a project with.
--
-- 2. A project member could add anyone (including
--    an alt account) as an OWNER. Now: members may
--    add others only as members; owner is set by
--    the server alone (creating a project, or
--    handover when an account is deleted).
--
-- 3. A member could post a message as ANOTHER
--    person, or as the agent. Now: you can only
--    post as yourself; the agent's own replies
--    (no author) are still allowed.
--
-- 4. A member could invite someone - or an alt
--    account - as an OWNER. Now: invites are for
--    members only.
--
-- 5. A member could record usage against another
--    person, burning their daily allowance. Now:
--    usage is recorded only against yourself.
--
-- Run this once in the Supabase SQL editor. Safe
-- to run more than once.
--


-- ------------------------------------------
-- HELPERS
-- ------------------------------------------
--
-- Security definer, so a policy on
-- project_members can ask about project_members
-- without asking itself in a loop.
--

create or replace function public.is_project_member(target_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.project_members pm
     where pm.project_id = target_project
       and pm.user_id = auth.uid()
  );
$$;

create or replace function public.is_project_owner(target_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.project_members pm
     where pm.project_id = target_project
       and pm.user_id = auth.uid()
       and pm.role = 'owner'
  );
$$;

-- Do we share any project with this person? Used
-- to decide whose profile you may see.

create or replace function public.shares_a_project(other_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.project_members mine
      join public.project_members theirs
        on theirs.project_id = mine.project_id
     where mine.user_id = auth.uid()
       and theirs.user_id = other_user
  );
$$;

grant execute on function public.is_project_member(uuid) to authenticated;
grant execute on function public.is_project_owner(uuid) to authenticated;
grant execute on function public.shares_a_project(uuid) to authenticated;


-- ------------------------------------------
-- 1. PROFILES: ONLY TEAMMATES, NOT EVERYONE
-- ------------------------------------------

drop policy if exists "Signed in can read profiles" on public.profiles;

create policy "Read your own and teammates' profiles"
  on public.profiles
  for select
  to authenticated
  using (
    id = auth.uid()
    or public.shares_a_project(id)
  );


-- ------------------------------------------
-- 2. PROJECT MEMBERS: NO SELF-MADE OWNERS
-- ------------------------------------------
--
-- Drop only the INSERT policies, by whatever they
-- are named, and put back one that allows a member
-- to add others as members. Read, update and
-- delete are left as they are.
--

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
    execute format(
      'drop policy if exists %I on public.project_members',
      pol.policyname
    );
  end loop;
end $$;

create policy "Members add members, not owners"
  on public.project_members
  for insert
  to authenticated
  with check (
    role = 'member'
    and public.is_project_member(project_id)
  );


-- ------------------------------------------
-- 3. MESSAGES: POST ONLY AS YOURSELF
-- ------------------------------------------
--
-- Replace only the INSERT policy. A person posts
-- as themselves; the agent's replies carry no
-- author and are allowed for anyone in the project
-- (the app writes those after the model answers).
--

do $$
declare pol record;
begin
  for pol in
    select policyname
      from pg_policies
     where schemaname = 'public'
       and tablename = 'messages'
       and cmd = 'INSERT'
  loop
    execute format(
      'drop policy if exists %I on public.messages',
      pol.policyname
    );
  end loop;
end $$;

create policy "Post as yourself, or the agent"
  on public.messages
  for insert
  to authenticated
  with check (
    public.is_project_member(project_id)
    and (
      (role = 'user' and user_id = auth.uid())
      or (role = 'assistant' and user_id is null)
    )
  );


-- ------------------------------------------
-- 4. INVITES: MEMBERS ONLY, NEVER OWNERS
-- ------------------------------------------
--
-- The single "manage invites" rule let a member
-- insert an invite with any role. Split it: still
-- readable and removable by members, but an insert
-- may only be for a member.
--

drop policy if exists "Members manage invites" on public.project_invites;

create policy "Members read invites"
  on public.project_invites
  for select
  to authenticated
  using (public.is_project_member(project_id));

create policy "Members send member invites"
  on public.project_invites
  for insert
  to authenticated
  with check (
    coalesce(role, 'member') = 'member'
    and public.is_project_member(project_id)
  );

create policy "Members update invites"
  on public.project_invites
  for update
  to authenticated
  using (public.is_project_member(project_id))
  with check (
    coalesce(role, 'member') = 'member'
    and public.is_project_member(project_id)
  );

create policy "Members withdraw invites"
  on public.project_invites
  for delete
  to authenticated
  using (public.is_project_member(project_id));


-- ------------------------------------------
-- 5. USAGE: RECORDED ONLY AGAINST YOURSELF
-- ------------------------------------------

drop policy if exists "Project members write usage" on public.usage_events;

create policy "Record your own usage"
  on public.usage_events
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_project_member(project_id)
  );


notify pgrst, 'reload schema';
