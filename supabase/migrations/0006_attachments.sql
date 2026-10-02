-- ==========================================
-- ATTACHMENTS
-- ==========================================
--
-- Lets people hand the agent a file instead of
-- only asking it to write one.
--
-- The file itself goes to Supabase Storage. The
-- text pulled out of it is stored here, so the
-- prompt does not have to re-parse a PDF on
-- every turn, and so search can reach inside
-- documents later.
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--

create extension if not exists "pgcrypto";


create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id)
    on delete cascade,

  channel_id uuid
    references public.channels (id)
    on delete set null,

  -- Set once the message it belongs to is sent.
  -- Null means uploaded but not yet posted.
  message_id uuid
    references public.messages (id)
    on delete cascade,

  uploaded_by uuid
    references auth.users (id)
    on delete set null,

  filename text not null,
  mime text not null default '',
  size_bytes integer not null default 0,

  -- Where the bytes live in the storage bucket.
  storage_path text not null,

  -- text | pdf | docx | image | other
  kind text not null default 'other',

  -- What the model gets to read. Null for images
  -- and anything unparseable.
  extracted_text text,

  -- True when the file held more text than we
  -- kept, so the UI can say so.
  truncated boolean not null default false,

  -- Why there is no text, in plain words.
  note text,

  created_at timestamptz not null default now()
);

create index if not exists attachments_message_idx
  on public.attachments (message_id);

create index if not exists attachments_project_idx
  on public.attachments (project_id, created_at desc);


alter table public.attachments
  enable row level security;

drop policy if exists
  "Project members read attachments"
  on public.attachments;

create policy "Project members read attachments"
  on public.attachments
  for select
  using (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = attachments.project_id
         and pm.user_id = auth.uid()
    )
  );

drop policy if exists
  "Project members add attachments"
  on public.attachments;

create policy "Project members add attachments"
  on public.attachments
  for insert
  with check (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = attachments.project_id
         and pm.user_id = auth.uid()
    )
  );

drop policy if exists
  "Project members update attachments"
  on public.attachments;

create policy "Project members update attachments"
  on public.attachments
  for update
  using (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = attachments.project_id
         and pm.user_id = auth.uid()
    )
  );

drop policy if exists
  "Project members delete attachments"
  on public.attachments;

create policy "Project members delete attachments"
  on public.attachments
  for delete
  using (
    exists (
      select 1
        from public.project_members pm
       where pm.project_id = attachments.project_id
         and pm.user_id = auth.uid()
    )
  );


-- ------------------------------------------
-- STORAGE
-- ------------------------------------------
--
-- Private bucket. Files are read through signed
-- URLs, so nothing is reachable without being in
-- the project.
--
-- Objects are keyed as <project_id>/<uuid>-<name>,
-- and the policies below read that first path
-- segment to decide who may touch them.
--

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;


drop policy if exists
  "Project members read attachment files"
  on storage.objects;

create policy "Project members read attachment files"
  on storage.objects
  for select
  using (
    bucket_id = 'attachments'
    and exists (
      select 1
        from public.project_members pm
       where pm.user_id = auth.uid()
         and pm.project_id::text =
             (storage.foldername(name))[1]
    )
  );

drop policy if exists
  "Project members upload attachment files"
  on storage.objects;

create policy "Project members upload attachment files"
  on storage.objects
  for insert
  with check (
    bucket_id = 'attachments'
    and exists (
      select 1
        from public.project_members pm
       where pm.user_id = auth.uid()
         and pm.project_id::text =
             (storage.foldername(name))[1]
    )
  );

drop policy if exists
  "Project members delete attachment files"
  on storage.objects;

create policy "Project members delete attachment files"
  on storage.objects
  for delete
  using (
    bucket_id = 'attachments'
    and exists (
      select 1
        from public.project_members pm
       where pm.user_id = auth.uid()
         and pm.project_id::text =
             (storage.foldername(name))[1]
    )
  );


-- Same privilege gap as the other tables: the
-- policies decide which rows, but the role still
-- needs the table itself.

grant select, insert, update, delete
  on public.attachments to authenticated;

grant all privileges
  on public.attachments to service_role;
