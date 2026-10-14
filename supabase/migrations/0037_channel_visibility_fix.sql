-- ==========================================
-- FIX: CREATING A CHANNEL AFTER 0034
-- ==========================================
--
-- 0034's "who can see a channel" rule looked the channel
-- up by id. When a channel is created and the new row is
-- asked for back in the same statement, that lookup does
-- not find it yet - so the database refused with "new row
-- violates row-level security policy for table
-- channels".
--
-- The rule now decides from the row itself (its project,
-- whether it is private) instead of looking it up. Same
-- rule as 0035: open channels for everyone in the
-- project, viewers included; private channels for the
-- people listed, plus owners and admins.
--
-- Run once in the Supabase SQL editor, after 0034 and
-- 0035. Safe to run more than once.
--

create or replace function public.can_view_channel_row(
  p_channel_id uuid,
  p_project_id uuid,
  p_restricted boolean
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
       and (
         not coalesce(p_restricted, false)
         or pm.role in ('owner', 'admin')
         or exists (
           select 1
             from public.channel_members cm
            where cm.channel_id = p_channel_id
              and cm.user_id = auth.uid()
         )
       )
  );
$$;

grant execute on function public.can_view_channel_row(uuid, uuid, boolean) to authenticated;

drop policy if exists "See channels you are allowed in" on public.channels;

create policy "See channels you are allowed in"
  on public.channels
  for select
  to authenticated
  using (public.can_view_channel_row(id, project_id, restricted));

notify pgrst, 'reload schema';
