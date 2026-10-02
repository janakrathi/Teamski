-- ==========================================
-- FORGET WHAT A DELETED MESSAGE TAUGHT IT
-- ==========================================
--
-- Facts the agent picks up now record the
-- message they were learned from. Deleting that
-- message deletes them with it.
--
-- Facts remembered before this ran have no link
-- and stay until cleared. To start clean:
--
--   delete from public.memory_facts
--    where source_message_id is null;
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--

alter table public.memory_facts
  add column if not exists source_message_id uuid
    references public.messages (id)
    on delete cascade;

create index if not exists
  memory_facts_source_message_idx
  on public.memory_facts (source_message_id);
