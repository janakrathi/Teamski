import type { Instrumentation } from "next";


// ==========================================
// ERRORS AND A STUCK WORKER, BY EMAIL
// ==========================================
//
// Two things the web app watches for, in
// production only, and emails about through
// lib/alerts.ts:
//
//   - a server error Next caught while rendering
//     a page or answering a route
//   - a worker that has stopped: tasks left queued
//     or schedules left overdue for ten minutes
//     means nothing is picking them up
//
// The worker watches the built-in AI and the
// database itself (worker/index.mts). Most API
// routes catch their own errors and answer with a
// message; the ones that matter call raiseAlert
// where they catch.
//

const production = () =>
  process.env.NODE_ENV === "production" && process.env.NEXT_RUNTIME === "nodejs";


export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context
) => {
  if (!production()) {
    return;
  }

  const { describeError, raiseAlert } = await import("./lib/alerts");

  await raiseAlert("web", {
    key: `request:${context.routePath}`,
    title: `Server error on ${request.method} ${context.routePath}`,
    detail: `${request.method} ${request.path.split("?")[0]} (${context.routeType})\n\n${describeError(error)}`,
  });
};


export async function register() {
  if (!production()) {
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return;
  }

  const { createClient } = await import("@supabase/supabase-js");

  const { raiseAlert } = await import("./lib/alerts");

  const db = createClient(url, key, { auth: { persistSession: false } });

  const STUCK_AFTER_MS = 10 * 60 * 1000;

  async function check() {
    try {
      const cutoff = new Date(Date.now() - STUCK_AFTER_MS).toISOString();

      const [runs, schedules] = await Promise.all([
        db
          .from("agent_runs")
          .select("id", { count: "exact", head: true })
          .eq("status", "queued")
          .lt("created_at", cutoff),

        db
          .from("agent_schedules")
          .select("id", { count: "exact", head: true })
          .eq("enabled", true)
          .lt("next_run_at", cutoff),
      ]);

      // A table that does not exist yet is not a
      // stuck worker.
      if (runs.error && schedules.error) {
        return;
      }

      const waiting = (runs.count ?? 0) + (schedules.count ?? 0);

      await raiseAlert("web", {
        key: "worker-stalled",
        level: waiting > 0 ? "problem" : "resolved",
        title:
          waiting > 0
            ? "The worker seems to have stopped"
            : "The worker is picking up tasks again",
        detail:
          waiting > 0
            ? `${runs.count ?? 0} background ${runs.count === 1 ? "task has" : "tasks have"} been queued and ${
                schedules.count ?? 0
              } ${schedules.count === 1 ? "schedule has" : "schedules have"} been due for over 10 minutes.\n\nOn the server: pm2 status, then pm2 logs worker --lines 100`
            : "",
      });
    } catch (error) {
      console.error("Worker check failed:", error);
    }
  }

  // Not the moment the server starts - the worker
  // may be restarting alongside it.
  setTimeout(() => {
    void check();
    setInterval(() => void check(), 5 * 60 * 1000).unref?.();
  }, 3 * 60 * 1000).unref?.();
}
