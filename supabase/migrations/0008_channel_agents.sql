-- ==========================================
-- AN AGENT PER CHANNEL
-- ==========================================
--
-- A project had one agent that answered
-- everywhere, so research and design questions
-- reached the same generalist with the same
-- instructions.
--
-- Memory is already scoped to a channel, so a
-- channel was half a workspace of its own
-- already. This gives it the other half: its own
-- agent, with its own instructions and model.
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--

-- Which channel an agent belongs to. Null means
-- the older project-wide agent, which still
-- answers in channels that have none of their
-- own.

alter table public.agents
  add column if not exists channel_id uuid
    references public.channels (id)
    on delete cascade;

-- How this particular agent should behave. The
-- description is what people read; this is what
-- the model reads.

alter table public.agents
  add column if not exists instructions text;

create index if not exists agents_channel_idx
  on public.agents (channel_id);

-- One agent per channel, while still allowing
-- several project-wide agents with no channel.

create unique index if not exists agents_channel_unique
  on public.agents (channel_id)
  where channel_id is not null;


-- ------------------------------------------
-- GIVE EVERY EXISTING CHANNEL AN AGENT
-- ------------------------------------------
--
-- Named after the channel, so #design gets a
-- "design agent" rather than an empty seat.
--

insert into public.agents (
  project_id,
  channel_id,
  name,
  description,
  status,
  provider,
  model
)
select
  c.project_id,
  c.id,
  initcap(replace(c.name, '-', ' ')) || ' agent',
  'The agent for #' || c.name || '.',
  'idle',
  'ollama',
  'qwen3:1.7b'
from public.channels c
where not exists (
  select 1
    from public.agents a
   where a.channel_id = c.id
);
