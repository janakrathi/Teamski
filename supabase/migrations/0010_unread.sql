-- ==========================================
-- WHAT HAVE I NOT SEEN
-- ==========================================
--
-- The sidebar has been a flat list of names:
-- nothing in it says where anything happened.
-- The only way to find out whether a teammate
-- or an agent said something in #design was to
-- open #design and look. With one channel that
-- is fine. With five channels and three agents
-- it means opening all eight, every time.
--
-- So: remember where each person had got to,
-- and count what has arrived since.
--
-- Two things deliberately do not count as
-- unread:
--
--   Your own messages. You were there.
--
--   Anything from before you joined. A new
--   teammate should not open the app to a
--   thousand-message backlog marked new.
--
-- An agent's reply does count, even though you
-- may have prompted it - a background agent that
-- finished in another channel is exactly the
-- kind of thing this is for.
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--


-- ------------------------------------------
-- HOW FAR EACH PERSON HAS READ
-- ------------------------------------------

create table if not exists public.channel_reads (
  user_id uuid not null
    references auth.users (id)
    on delete cascade,

  channel_id uuid not null
    references public.channels (id)
    on delete cascade,

  last_read_at timestamptz not null default now(),

  primary key (user_id, channel_id)
);

create table if not exists public.dm_reads (
  user_id uuid not null
    references auth.users (id)
    on delete cascade,

  conversation_id uuid not null
    references public.dm_conversations (id)
    on delete cascade,

  last_read_at timestamptz not null default now(),

  primary key (user_id, conversation_id)
);


-- ------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------
--
-- Where you have read up to is yours alone. No
-- policy lets anyone see anybody else's.
--

alter table public.channel_reads
  enable row level security;

alter table public.dm_reads
  enable row level security;

drop policy if exists
  "Own channel reads" on public.channel_reads;

create policy "Own channel reads"
  on public.channel_reads
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists
  "Own dm reads" on public.dm_reads;

create policy "Own dm reads"
  on public.dm_reads
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


-- ------------------------------------------
-- START EVERYONE FROM ZERO
-- ------------------------------------------
--
-- Without this, the day this ships is the day
-- every existing member opens the app to their
-- entire history marked unread - 106 messages in
-- #general, on a workspace that had never had an
-- unread count to fall behind on. Nobody is
-- behind on messages they have already read.
--
-- So: everyone who is here now is caught up now,
-- and counting starts from this moment. Someone
-- who joins later still falls back to their join
-- date, which for them is the right answer.
--
-- do nothing on conflict, so re-running this
-- never moves a marker that already exists.
--

insert into public.channel_reads (
  user_id, channel_id, last_read_at
)
select pm.user_id, c.id, now()
  from public.project_members pm
  join public.channels c
    on c.project_id = pm.project_id
on conflict (user_id, channel_id) do nothing;

insert into public.dm_reads (
  user_id, conversation_id, last_read_at
)
select m.user_id, m.conversation_id, now()
  from public.dm_members m
on conflict (user_id, conversation_id) do nothing;


-- ------------------------------------------
-- COUNTING, IN ONE ROUND TRIP
-- ------------------------------------------
--
-- The sidebar needs every channel at once. Asked
-- one channel at a time this would be a query
-- per channel on every poll, so it is a single
-- grouped count instead.
--

create or replace function public.unread_channels(
  p_project_id uuid
)
returns table (
  channel_id uuid,
  unread bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select c.id,
         count(m.id)

    from public.channels c

    join public.project_members pm
      on pm.project_id = c.project_id
     and pm.user_id = auth.uid()

    left join public.channel_reads r
      on r.channel_id = c.id
     and r.user_id = auth.uid()

    -- Falling back to the moment you joined is
    -- what keeps a new member's first login from
    -- being a wall of unread history.

    left join public.messages m
      on m.channel_id = c.id
     and m.user_id is distinct from auth.uid()
     and m.created_at > coalesce(
           r.last_read_at,
           pm.created_at
         )

   where c.project_id = p_project_id

   group by c.id;
$$;


create or replace function public.unread_dms()
returns table (
  conversation_id uuid,
  other_user_id uuid,
  unread bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select me.conversation_id,
         them.user_id,
         count(dm.id)

    from public.dm_members me

    -- The sidebar lists people, not conversation
    -- ids, so the other member comes back with
    -- the count.

    join public.dm_members them
      on them.conversation_id = me.conversation_id
     and them.user_id <> me.user_id

    left join public.dm_reads r
      on r.conversation_id = me.conversation_id
     and r.user_id = me.user_id

    left join public.dm_messages dm
      on dm.conversation_id = me.conversation_id
     and dm.user_id <> me.user_id
     and dm.created_at > coalesce(
           r.last_read_at,
           me.created_at
         )

   where me.user_id = auth.uid()

   group by me.conversation_id, them.user_id;
$$;


-- ------------------------------------------
-- GRANTS
-- ------------------------------------------

grant select, insert, update, delete
  on public.channel_reads,
     public.dm_reads
  to authenticated;

grant all privileges
  on public.channel_reads,
     public.dm_reads
  to service_role;

grant execute
  on function public.unread_channels(uuid)
  to authenticated;

grant execute
  on function public.unread_dms()
  to authenticated;
