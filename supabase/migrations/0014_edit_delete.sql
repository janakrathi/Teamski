-- ==========================================
-- CHANGING YOUR MIND
-- ==========================================
--
-- Nothing written here could ever be edited or
-- taken back. A typo to your team was permanent,
-- and so was anything sent to the wrong channel.
--
-- Two rules, and they are different on purpose:
--
--   You may edit your own message. Not anybody
--   else's, and not the agent's - putting words
--   in its mouth would make the whole transcript
--   worthless as a record of what it said.
--
--   You may delete your own message, and anyone
--   in the project may delete the agent's. An
--   agent reply is not anybody's to defend, and
--   a wrong one left sitting in a channel is
--   just clutter.
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--


-- ------------------------------------------
-- SAYING SO
-- ------------------------------------------
--
-- An edited message that does not admit it is a
-- small dishonesty, and in a shared channel
-- other people have already read the first
-- version.
--

alter table public.messages
  add column if not exists edited_at timestamptz;

alter table public.dm_messages
  add column if not exists edited_at timestamptz;


-- ------------------------------------------
-- CHANNEL MESSAGES
-- ------------------------------------------

drop policy if exists
  "Authors edit their own messages"
  on public.messages;

create policy "Authors edit their own messages"
  on public.messages
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


drop policy if exists
  "Delete your own, or the agent's"
  on public.messages;

create policy "Delete your own, or the agent's"
  on public.messages
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    or (
      -- The agent writes with no author. Anyone
      -- in the project may clear those.
      user_id is null
      and exists (
        select 1
          from public.project_members pm
         where pm.project_id = messages.project_id
           and pm.user_id = auth.uid()
      )
    )
  );


-- ------------------------------------------
-- DIRECT MESSAGES
-- ------------------------------------------
--
-- No agent here, so there is only the one rule.
--

drop policy if exists
  "Authors edit their own DMs"
  on public.dm_messages;

create policy "Authors edit their own DMs"
  on public.dm_messages
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


drop policy if exists
  "Authors delete their own DMs"
  on public.dm_messages;

create policy "Authors delete their own DMs"
  on public.dm_messages
  for delete
  to authenticated
  using (user_id = auth.uid());


grant update, delete
  on public.messages,
     public.dm_messages
  to authenticated;
