-- ==========================================
-- RECOVERING RUNS FROM A DEAD WORKER
-- ==========================================
--
-- claim_agent_run only ever looks at runs in the
-- 'queued' state. That is right while a worker
-- is alive, and wrong the moment one is not.
--
-- Kill the worker mid-run - Ctrl+C, a crash, a
-- reboot - and the row stays 'running' with a
-- claim nobody holds. No worker will ever take
-- it again, the dock reports work that is not
-- happening, and the agent sits at 'working'
-- forever. There is no way out of that state
-- from inside the app.
--
-- A run already stores its own messages and step
-- count, so nothing is lost by handing it back
-- to the queue: whoever picks it up next carries
-- on from the step that was interrupted.
--
-- The worker now touches claimed_at while it
-- works, so "the claim has gone quiet" is a
-- reliable signal that the worker behind it is
-- gone.
--
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once.
--

create or replace function public.reap_stale_runs(
  max_age_seconds integer default 90
)
returns setof public.agent_runs
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  reaped public.agent_runs;
begin
  for reaped in
    update public.agent_runs
       set status = 'queued',
           claimed_at = null,
           claimed_by = null,
           updated_at = now()
     where id in (
       select id
         from public.agent_runs
        where status = 'running'
          and claimed_at is not null
          and claimed_at <
              now() - make_interval(
                secs => max_age_seconds
              )
        for update skip locked
     )
    returning *
  loop
    -- The agent was left mid-sentence too. Say
    -- idle rather than working: nothing is
    -- advancing it until a worker takes it back,
    -- and claiming it sets working again.

    update public.agents
       set status = 'idle',
           updated_at = now()
     where id = reaped.agent_id
       and status = 'working';

    return next reaped;
  end loop;

  return;
end;
$$;


-- A run that has gone quiet is worth finding
-- quickly, and the reaper scans on exactly this.

create index if not exists agent_runs_claim_idx
  on public.agent_runs (status, claimed_at);


-- The worker connects as service_role, and a
-- security definer function still needs to be
-- callable by it.

grant execute
  on function public.reap_stale_runs(integer)
  to service_role;

grant execute
  on function public.claim_agent_run(text)
  to service_role;
