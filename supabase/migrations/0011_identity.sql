-- ==========================================
-- WHO PEOPLE ARE, AND WHO ELSE IS HERE
-- ==========================================
--
-- Two gaps that turn out to be the same gap.
--
-- Everybody in the app is their email address.
-- The sidebar says someone@example.com, DMs
-- are addressed to an inbox, and mentions are
-- built out of whatever is left after stripping
-- the @. Nobody calls a colleague by their email
-- address.
--
-- And there was no way to get a second person
-- into a project at all. Both existing members
-- are there because somebody wrote the row by
-- hand.
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--


-- ------------------------------------------
-- A NAME AND A HANDLE
-- ------------------------------------------
--
-- display_name is what people read. username is
-- what they type after an @, so it is unique,
-- lowercase and has no spaces in it.
--

alter table public.profiles
  add column if not exists username text;

-- Case matters for uniqueness but not for
-- typing, so the index is on the lowered form
-- and two people cannot take Jan and jan.

create unique index if not exists
  profiles_username_key
  on public.profiles (lower(username))
  where username is not null;

-- "agent" addresses the AI, and letting someone
-- take it would make every mention ambiguous.

alter table public.profiles
  drop constraint if exists profiles_username_shape;

alter table public.profiles
  add constraint profiles_username_shape
  check (
    username is null
    or (
      username ~ '^[a-zA-Z0-9_.-]{2,24}$'
      and lower(username) <> 'agent'
      and lower(username) <> 'everyone'
      and lower(username) <> 'channel'
    )
  );


-- ------------------------------------------
-- SEED FROM WHAT IS ALREADY THERE
-- ------------------------------------------
--
-- The local part of the address is a reasonable
-- first guess, and people can change it. Anyone
-- whose guess collides keeps a null username
-- until they pick one, rather than being handed
-- somebody else's name with a number stuck on.
--

update public.profiles p
   set username = candidate.value
  from (
    select id,
           regexp_replace(
             split_part(email, '@', 1),
             '[^a-zA-Z0-9_.-]',
             '',
             'g'
           ) as value
      from public.profiles
  ) as candidate
 where p.id = candidate.id
   and p.username is null
   and length(candidate.value) between 2 and 24
   and lower(candidate.value) not in (
     'agent', 'everyone', 'channel'
   )
   and not exists (
     select 1
       from public.profiles other
      where other.id <> p.id
        and lower(other.username) =
            lower(candidate.value)
   );


-- ------------------------------------------
-- EDITING YOUR OWN PROFILE
-- ------------------------------------------
--
-- Reading is open to anyone signed in, because
-- the whole point is seeing who your teammates
-- are. Writing is yours alone.
--

alter table public.profiles
  enable row level security;

drop policy if exists
  "Signed in can read profiles"
  on public.profiles;

create policy "Signed in can read profiles"
  on public.profiles
  for select
  to authenticated
  using (true);

drop policy if exists
  "Own profile is editable"
  on public.profiles;

create policy "Own profile is editable"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());


-- ------------------------------------------
-- INVITING SOMEBODY
-- ------------------------------------------
--
-- An invite is by email, because that is all you
-- know about someone who has not signed up yet.
--
-- If they already have an account they are added
-- straight to the project. If they do not, the
-- invite waits here until they sign up, and is
-- claimed on their first visit.
--

create table if not exists public.project_invites (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id)
    on delete cascade,

  -- Stored lowercase; addresses are matched
  -- case-insensitively.
  email text not null,

  role text not null default 'member',

  invited_by uuid
    references auth.users (id)
    on delete set null,

  created_at timestamptz not null default now(),

  accepted_at timestamptz,

  unique (project_id, email)
);

create index if not exists
  project_invites_email_idx
  on public.project_invites (email)
  where accepted_at is null;


alter table public.project_invites
  enable row level security;

-- Members of a project can see and manage its
-- invites.

drop policy if exists
  "Members manage invites"
  on public.project_invites;

create policy "Members manage invites"
  on public.project_invites
  for all
  to authenticated
  using (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id =
             project_invites.project_id
         and pm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id =
             project_invites.project_id
         and pm.user_id = auth.uid()
    )
  );

-- And you can always see an invite addressed to
-- you, which is how one gets claimed.

drop policy if exists
  "See invites addressed to me"
  on public.project_invites;

create policy "See invites addressed to me"
  on public.project_invites
  for select
  to authenticated
  using (
    lower(email) = lower(
      coalesce(auth.jwt() ->> 'email', '')
    )
  );


-- ------------------------------------------
-- CLAIMING WHAT IS WAITING FOR YOU
-- ------------------------------------------
--
-- Called when someone opens the app. Turns every
-- unaccepted invite for their address into
-- membership, and does nothing at all if there
-- are none.
--
-- security definer because joining a project
-- means writing a project_members row for a
-- project you are, by definition, not yet a
-- member of.
--

create or replace function public.claim_invites()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  claimed integer := 0;
  address text;
begin
  address := lower(
    coalesce(auth.jwt() ->> 'email', '')
  );

  if address = '' then
    return 0;
  end if;

  insert into public.project_members (
    project_id, user_id, role
  )
  select i.project_id, auth.uid(), i.role
    from public.project_invites i
   where lower(i.email) = address
     and i.accepted_at is null
  on conflict do nothing;

  update public.project_invites
     set accepted_at = now()
   where lower(email) = address
     and accepted_at is null;

  get diagnostics claimed = row_count;

  return claimed;
end;
$$;


grant select, insert, update, delete
  on public.project_invites
  to authenticated;

grant all privileges
  on public.project_invites
  to service_role;

grant execute
  on function public.claim_invites()
  to authenticated;
