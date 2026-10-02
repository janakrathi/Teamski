-- ==========================================
-- FILES IN A DIRECT MESSAGE
-- ==========================================
--
-- Attachments were built for channels and only
-- ever described one: project_id is NOT NULL,
-- message_id points at public.messages, and
-- every policy asks whether you are in the
-- project.
--
-- A direct message has none of those. It has no
-- project - two people can share a file without
-- it belonging to any of their projects - and
-- its rows live in dm_messages.
--
-- So the row learns a second home, and the
-- policies learn a second question. Anything
-- already stored keeps the shape it has: a
-- channel attachment still has a project and no
-- conversation, and nothing about it changes.
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--


-- ------------------------------------------
-- A SECOND PLACE TO BELONG
-- ------------------------------------------

alter table public.attachments
  add column if not exists conversation_id uuid
    references public.dm_conversations (id)
    on delete cascade;

-- Set once the message it belongs to is sent.
-- Null means uploaded but not yet posted, same
-- as message_id in a channel.

alter table public.attachments
  add column if not exists dm_message_id uuid
    references public.dm_messages (id)
    on delete cascade;

create index if not exists
  attachments_dm_message_idx
  on public.attachments (dm_message_id);

create index if not exists
  attachments_conversation_idx
  on public.attachments (conversation_id, created_at desc);


-- A DM attachment has no project, so the column
-- can no longer insist on one.

alter table public.attachments
  alter column project_id drop not null;


-- One home or the other, never neither and never
-- both. Without this a row with nothing set
-- would be readable by nobody and deletable by
-- nothing.

alter table public.attachments
  drop constraint if exists attachments_belongs_somewhere;

alter table public.attachments
  add constraint attachments_belongs_somewhere
  check (
    (project_id is not null
     and conversation_id is null)
    or
    (conversation_id is not null
     and project_id is null)
  );


-- ------------------------------------------
-- WHO MAY SEE THEM
-- ------------------------------------------
--
-- The existing policies ask about project
-- membership and answer false for a DM row,
-- since its project_id is null. Rather than
-- widen them and risk loosening the channel
-- case, DMs get their own - a row is reachable
-- if you are in the project, or if you are in
-- the conversation.
--

drop policy if exists
  "DM members read attachments"
  on public.attachments;

create policy "DM members read attachments"
  on public.attachments
  for select
  to authenticated
  using (
    conversation_id is not null
    and exists (
      select 1
        from public.dm_members m
       where m.conversation_id =
             attachments.conversation_id
         and m.user_id = auth.uid()
    )
  );

drop policy if exists
  "DM members add attachments"
  on public.attachments;

create policy "DM members add attachments"
  on public.attachments
  for insert
  to authenticated
  with check (
    conversation_id is not null
    and exists (
      select 1
        from public.dm_members m
       where m.conversation_id =
             attachments.conversation_id
         and m.user_id = auth.uid()
    )
  );

drop policy if exists
  "DM members update attachments"
  on public.attachments;

create policy "DM members update attachments"
  on public.attachments
  for update
  to authenticated
  using (
    conversation_id is not null
    and exists (
      select 1
        from public.dm_members m
       where m.conversation_id =
             attachments.conversation_id
         and m.user_id = auth.uid()
    )
  );
