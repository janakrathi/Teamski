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
