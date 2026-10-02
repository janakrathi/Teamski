-- ==========================================
-- NO FORGED "AGENT" MESSAGES
-- ==========================================
--
-- Until now the agent's reply was saved by the
-- browser, so the message-insert rule had to allow
-- an agent message (role 'assistant', no author)
-- from any project member. That let a member post
-- a fake "Agent" message straight to the database -
-- an authoritative-looking "Agent: send me your
-- password" inside a project they are in.
--
-- The server now saves the agent's reply itself
-- (app/api/chat), with the service role, which
-- bypasses these rules. So a member may only insert
-- their OWN message, as themselves. Agent messages
-- come only from the server.
--
-- Replaces just the INSERT rule on messages, by
-- whatever it is named. Read, edit and delete are
-- left as they are.
--
-- Run this once in the Supabase SQL editor, after
-- deploying the matching app. Safe to re-run.
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

create policy "Post your own messages"
  on public.messages
  for insert
  to authenticated
  with check (
    role = 'user'
    and user_id = auth.uid()
    and public.is_project_member(project_id)
  );

notify pgrst, 'reload schema';
