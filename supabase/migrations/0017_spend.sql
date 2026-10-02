-- ==========================================
-- WHO SPENT IT, AND HOW MUCH IS LEFT
-- ==========================================
--
-- A shared project key means one person's card
-- pays for other people's messages. That is the
-- right shape for a company and a bad shape
-- without two things: the owner being able to see
-- where the money went, and a ceiling.
--
-- Without a ceiling, one agent left in a loop
-- overnight is somebody else's bill in the
-- morning, and the first they hear of it is the
-- invoice.
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--


-- ------------------------------------------
-- WHOSE KEY PAID
-- ------------------------------------------
--
-- Tokens were already recorded per person and per
-- project. What was missing is whose account they
-- were charged to, which is the difference
-- between "Sam used a lot of Claude" and "Sam
-- used a lot of Claude on my card".
--
--   you      - their own key
--   project  - the shared one
--   server   - an environment variable
--   local    - the machine, which costs nothing
--

alter table public.usage_events
  add column if not exists paid_by text
    not null default 'local';

create index if not exists
  usage_events_project_month_idx
  on public.usage_events
     (project_id, created_at desc);


-- ------------------------------------------
-- A CEILING ON THE SHARED KEY
-- ------------------------------------------
--
-- Null means no limit, which is the honest
-- default: a limit somebody did not choose would
-- stop their work at a number they never saw.
--
-- Dollars rather than tokens, because that is the
-- unit the bill arrives in and the only one
-- anybody reasons about.
--

alter table public.project_model_keys
  add column if not exists monthly_limit_usd
    numeric(10, 2);


-- ------------------------------------------
-- WHAT THE PROJECT HAS SPENT THIS MONTH
-- ------------------------------------------
--
-- Costed in the application rather than here,
-- since prices belong with the model catalogue
-- and change without a migration. This just adds
-- up the tokens that were charged to the shared
-- key.
--
-- security invoker, so it answers about projects
-- the caller is in and no others.
--

create or replace function public.project_spend(
  p_project_id uuid,
  p_since timestamptz
)
returns table (
  user_id uuid,
  model text,
  paid_by text,
  prompt_tokens bigint,
  response_tokens bigint,
  turns bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select u.user_id,
         u.model,
         u.paid_by,
         sum(u.prompt_tokens)::bigint,
         sum(u.response_tokens)::bigint,
         count(*)::bigint

    from public.usage_events u

    join public.project_members pm
      on pm.project_id = u.project_id
     and pm.user_id = auth.uid()

   where u.project_id = p_project_id
     and u.created_at >= p_since

   group by u.user_id, u.model, u.paid_by;
$$;


grant execute
  on function public.project_spend(uuid, timestamptz)
  to authenticated;
