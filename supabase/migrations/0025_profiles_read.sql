-- ==========================================
-- PROFILES: DROP EVERY READ RULE, KEEP ONE
-- ==========================================
--
-- Migration 0024 replaced the read policy named
-- "Signed in can read profiles", but a second,
-- older read policy under a different name was
-- still letting any signed-in person read every
-- profile - and every email. This drops ALL read
-- policies on profiles, whatever they are called
-- (including any catch-all "for all" policy), and
-- puts back exactly two rules:
--
--   read   your own profile, and profiles of
--          people you share a project with
--   write  your own profile only
--
-- The write rule is recreated too, in case the
-- catch-all that is being dropped was the only
-- thing granting it. However profiles are first
-- created (a signup trigger) is untouched.
--
-- Run this once in the Supabase SQL editor. Safe
-- to run more than once.
--

do $$
declare pol record;
begin
  for pol in
    select policyname, cmd
      from pg_policies
     where schemaname = 'public'
       and tablename = 'profiles'
       and cmd in ('SELECT', 'UPDATE', 'ALL')
  loop
    execute format(
      'drop policy if exists %I on public.profiles',
      pol.policyname
    );
  end loop;
end $$;

create policy "Read your own and teammates' profiles"
  on public.profiles
  for select
  to authenticated
  using (
    id = auth.uid()
    or public.shares_a_project(id)
  );

create policy "Own profile is editable"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

notify pgrst, 'reload schema';
