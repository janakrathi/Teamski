import { createClient } from "@/lib/supabase/server";

import { adminClient } from "@/lib/supabase/admin";

import {
  PLAN_LABELS,
  SCHEDULES_PER_PROJECT,
  can,
  projectOwnerPlan,
  type Plan,
  type ProjectRole,
} from "@/lib/plans";

import {
  checkTiming,
  describeTiming,
  nextRunAt,
  type Cadence,
  type ScheduleTiming,
} from "@/lib/agents/schedule";

import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};


// ==========================================
// A PROJECT'S SCHEDULED AGENTS
// ==========================================
//
// Listing, adding, changing and removing them.
// Row level security decides who may do what -
// members see and add, the creator or an owner
// changes and removes - so these handlers read and
// write as the person, and only check what a
// policy cannot: that the timing makes sense, and
// that the project's plan has room.
//
// The worker (worker/index.mts) is what actually
// runs them.
//

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLUMNS =
  "id, project_id, channel_id, created_by, title, task, cadence, time_of_day, weekday, month_day, timezone, enabled, next_run_at, last_run_at, last_run_id, last_error, created_at";

type Row = {
  id: string;
  project_id: string;
  channel_id: string;
  created_by: string | null;
  title: string;
  task: string;
  cadence: Cadence;
  time_of_day: string;
  weekday: number | null;
  month_day: number | null;
  timezone: string;
  enabled: boolean;
  next_run_at: string;
  last_run_at: string | null;
  last_run_id: string | null;
  last_error: string | null;
  created_at: string;
};


function timingOf(
  row: Pick<Row, "cadence" | "time_of_day" | "weekday" | "month_day" | "timezone">
): ScheduleTiming {
  return {
    cadence: row.cadence,
    timeOfDay: row.time_of_day,
    weekday: row.weekday,
    monthDay: row.month_day,
    timezone: row.timezone,
  };
}


function missingTable(error: { code?: string } | null) {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

const NEEDS_MIGRATION = {
  error: "Run supabase/migrations/0023_agent_schedules.sql first.",
  needsMigration: true,
};


async function signedIn() {
  const db = await createClient();

  const {
    data: { user },
  } = await db.auth.getUser();

  return { db, user };
}


async function membership(db: SupabaseClient, projectId: string, userId: string) {
  const { data } = await db
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  return (data?.role as string | undefined) ?? null;
}


// Timing fields from a request body, in the shape
// the rest of the file uses.

function timingFrom(body: Record<string, unknown>): Partial<ScheduleTiming> {
  const number = (value: unknown) =>
    value === null || value === undefined || value === "" ? null : Number(value);

  return {
    cadence: body.cadence as Cadence,
    timeOfDay: typeof body.timeOfDay === "string" ? body.timeOfDay : undefined,
    weekday: number(body.weekday),
    monthDay: number(body.monthDay),
    timezone: typeof body.timezone === "string" ? body.timezone : undefined,
  };
}


// ------------------------------------------
// LIST
// ------------------------------------------

export async function GET(request: Request, context: RouteContext) {
  const { id: projectId } = await context.params;

  const { db, user } = await signedIn();

  if (!user) {
    return Response.json({ error: "You must be logged in." }, { status: 401 });
  }

  if (!uuid.test(projectId)) {
    return Response.json({ error: "Invalid project ID." }, { status: 400 });
  }

  const role = await membership(db, projectId, user.id);

  if (!role) {
    return Response.json({ error: "You are not in this project." }, { status: 403 });
  }

  const channelId = new URL(request.url).searchParams.get("channelId");

  let query = db
    .from("agent_schedules")
    .select(COLUMNS)
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (channelId && uuid.test(channelId)) {
    query = query.eq("channel_id", channelId);
  }

  const { data, error } = await query;

  if (error) {
    return Response.json(
      missingTable(error) ? NEEDS_MIGRATION : { error: error.message },
      { status: missingTable(error) ? 400 : 500 }
    );
  }

  const rows = (data ?? []) as Row[];

  // Names for "added by", and whether the last run
  // finished.

  const people = [
    ...new Set(rows.map((row) => row.created_by).filter(Boolean)),
  ] as string[];

  const runs = rows.map((row) => row.last_run_id).filter(Boolean) as string[];

  const [profiles, lastRuns, total] = await Promise.all([
    people.length
      ? db.from("profiles").select("id, display_name, email").in("id", people)
      : null,

    runs.length ? db.from("agent_runs").select("id, status").in("id", runs) : null,

    db
      .from("agent_schedules")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId),
  ]);

  const nameOf = new Map(
    (
      (profiles?.data ?? []) as {
        id: string;
        display_name: string | null;
        email: string | null;
      }[]
    ).map((profile) => [profile.id, profile.display_name || profile.email || "Someone"])
  );

  const statusOf = new Map(
    ((lastRuns?.data ?? []) as { id: string; status: string }[]).map((run) => [
      run.id,
      run.status,
    ])
  );

  const plan: Plan = await projectOwnerPlan(
    (adminClient() as unknown as SupabaseClient | null) ?? db,
    projectId
  );

  return Response.json({
    schedules: rows.map((row) => ({
      id: row.id,
      channelId: row.channel_id,
      title: row.title,
      task: row.task,
      cadence: row.cadence,
      timeOfDay: row.time_of_day,
      weekday: row.weekday,
      monthDay: row.month_day,
      timezone: row.timezone,
      enabled: row.enabled,
      when: describeTiming(timingOf(row)),
      nextRunAt: row.next_run_at,
      lastRunAt: row.last_run_at,
      lastRunStatus: row.last_run_id ? (statusOf.get(row.last_run_id) ?? null) : null,
      lastError: row.last_error,
      addedBy: row.created_by
        ? (nameOf.get(row.created_by) ?? "Someone")
        : "A former member",
      canChange:
        row.created_by === user.id ||
        can(role as ProjectRole, "manage_schedules"),
    })),

    limit: SCHEDULES_PER_PROJECT[plan],
    used: total.count ?? rows.length,
    planLabel: PLAN_LABELS[plan],
  });
}


// ------------------------------------------
// ADD
// ------------------------------------------

export async function POST(request: Request, context: RouteContext) {
  const { id: projectId } = await context.params;

  const { db, user } = await signedIn();

  if (!user) {
    return Response.json({ error: "You must be logged in." }, { status: 401 });
  }

  if (!uuid.test(projectId) || !(await membership(db, projectId, user.id))) {
    return Response.json({ error: "You are not in this project." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const channelId = typeof body.channelId === "string" ? body.channelId : "";

  const task = typeof body.task === "string" ? body.task.trim() : "";

  const title =
    (typeof body.title === "string" ? body.title.trim() : "").slice(0, 80) ||
    task.split(/[.\n]/)[0].slice(0, 60) ||
    "Scheduled task";

  if (!uuid.test(channelId)) {
    return Response.json({ error: "Choose a channel." }, { status: 400 });
  }

  if (!task) {
    return Response.json({ error: "Say what the agent should do." }, { status: 400 });
  }

  if (task.length > 2000) {
    return Response.json(
      { error: "Keep the task under 2,000 characters." },
      { status: 400 }
    );
  }

  const timing = timingFrom(body);

  const wrong = checkTiming(timing);

  if (wrong) {
    return Response.json({ error: wrong }, { status: 400 });
  }

  // The channel has to be in this project.

  const { data: channel } = await db
    .from("channels")
    .select("id")
    .eq("id", channelId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!channel) {
    return Response.json(
      { error: "That channel is not in this project." },
      { status: 400 }
    );
  }

  // Room on the plan. Counted with the service
  // role, so every schedule counts whoever can see
  // it.

  const admin = (adminClient() as unknown as SupabaseClient | null) ?? db;

  const plan = await projectOwnerPlan(admin, projectId);

  const { count, error: countError } = await admin
    .from("agent_schedules")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);

  if (missingTable(countError)) {
    return Response.json(NEEDS_MIGRATION, { status: 400 });
  }

  const limit = SCHEDULES_PER_PROJECT[plan];

  if ((count ?? 0) >= limit) {
    return Response.json(
      {
        error: `${PLAN_LABELS[plan]} includes ${limit} scheduled ${
          limit === 1 ? "task" : "tasks"
        } per project. Remove one, or the project owner can upgrade for more.`,
        upgrade: true,
      },
      { status: 403 }
    );
  }

  const full = timing as ScheduleTiming;

  const { data, error } = await db
    .from("agent_schedules")
    .insert({
      project_id: projectId,
      channel_id: channelId,
      created_by: user.id,
      title,
      task,
      cadence: full.cadence,
      time_of_day: full.timeOfDay,
      weekday: full.cadence === "weekly" ? full.weekday : null,
      month_day: full.cadence === "monthly" ? full.monthDay : null,
      timezone: full.timezone,
      next_run_at: nextRunAt(full).toISOString(),
    })
    .select(COLUMNS)
    .single();

  if (error || !data) {
    return Response.json(
      missingTable(error)
        ? NEEDS_MIGRATION
        : { error: error?.message ?? "Could not save the schedule." },
      { status: missingTable(error) ? 400 : 500 }
    );
  }

  const row = data as Row;

  return Response.json({
    ok: true,
    id: row.id,
    when: describeTiming(timingOf(row)),
    nextRunAt: row.next_run_at,
  });
}


// ------------------------------------------
// CHANGE: pause, resume, run now, or edit
// ------------------------------------------

export async function PATCH(request: Request, context: RouteContext) {
  const { id: projectId } = await context.params;

  const { db, user } = await signedIn();

  if (!user) {
    return Response.json({ error: "You must be logged in." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const scheduleId = typeof body.id === "string" ? body.id : "";

  if (!uuid.test(projectId) || !uuid.test(scheduleId)) {
    return Response.json({ error: "Invalid schedule." }, { status: 400 });
  }

  const { data: existing } = await db
    .from("agent_schedules")
    .select(COLUMNS)
    .eq("id", scheduleId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!existing) {
    return Response.json({ error: "Schedule not found." }, { status: 404 });
  }

  const row = existing as Row;

  // Whoever added it, or an owner or admin, may
  // change it.
  const role = await membership(db, projectId, user.id);

  if (
    row.created_by !== user.id &&
    !can(role as ProjectRole, "manage_schedules")
  ) {
    return Response.json(
      {
        error:
          "Only whoever added this schedule, or an owner or admin, can change it.",
      },
      { status: 403 }
    );
  }

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (body.action === "run-now") {
    // Due now: the worker picks it up within half a
    // minute, and works out the next time from then.
    update.next_run_at = new Date().toISOString();
    update.enabled = true;
    update.last_error = null;
  } else if (body.action === "pause") {
    update.enabled = false;
  } else if (body.action === "resume") {
    // From now, not from whenever it was paused -
    // no burst of runs for the days it was off.
    update.enabled = true;
    update.next_run_at = nextRunAt(timingOf(row)).toISOString();
    update.last_error = null;
  } else {
    const task = typeof body.task === "string" ? body.task.trim() : row.task;

    if (!task || task.length > 2000) {
      return Response.json(
        { error: "Say what the agent should do, in under 2,000 characters." },
        { status: 400 }
      );
    }

    const given = Object.fromEntries(
      Object.entries(timingFrom(body)).filter(
        ([, value]) => value !== undefined && value !== null
      )
    );

    const merged = { ...timingOf(row), ...given } as ScheduleTiming;

    const wrong = checkTiming(merged);

    if (wrong) {
      return Response.json({ error: wrong }, { status: 400 });
    }

    Object.assign(update, {
      task,
      title:
        (typeof body.title === "string" ? body.title.trim().slice(0, 80) : "") ||
        row.title,
      cadence: merged.cadence,
      time_of_day: merged.timeOfDay,
      weekday: merged.cadence === "weekly" ? merged.weekday : null,
      month_day: merged.cadence === "monthly" ? merged.monthDay : null,
      timezone: merged.timezone,
      next_run_at: nextRunAt(merged).toISOString(),
      last_error: null,
    });
  }

  // The permission was checked above; the write
  // goes through the service role so an admin is not
  // also stopped by a policy naming only the creator
  // or owner.

  const admin =
    (adminClient() as unknown as SupabaseClient | null) ??
    db;

  const { data, error } = await admin
    .from("agent_schedules")
    .update(update)
    .eq("id", scheduleId)
    .eq("project_id", projectId)
    .select("id")
    .maybeSingle();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return Response.json({ error: "Schedule not found." }, { status: 404 });
  }

  return Response.json({ ok: true });
}


// ------------------------------------------
// REMOVE
// ------------------------------------------

export async function DELETE(request: Request, context: RouteContext) {
  const { id: projectId } = await context.params;

  const { db, user } = await signedIn();

  if (!user) {
    return Response.json({ error: "You must be logged in." }, { status: 401 });
  }

  const scheduleId = new URL(request.url).searchParams.get("id") ?? "";

  if (!uuid.test(projectId) || !uuid.test(scheduleId)) {
    return Response.json({ error: "Invalid schedule." }, { status: 400 });
  }

  // Whoever added it, or an owner or admin, may
  // remove it.

  const { data: existing } = await db
    .from("agent_schedules")
    .select("created_by")
    .eq("id", scheduleId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!existing) {
    return Response.json({ error: "Schedule not found." }, { status: 404 });
  }

  const role = await membership(db, projectId, user.id);

  if (
    (existing as { created_by: string | null }).created_by !== user.id &&
    !can(role as ProjectRole, "manage_schedules")
  ) {
    return Response.json(
      {
        error:
          "Only whoever added this schedule, or an owner or admin, can remove it.",
      },
      { status: 403 }
    );
  }

  const admin =
    (adminClient() as unknown as SupabaseClient | null) ??
    db;

  const { error } = await admin
    .from("agent_schedules")
    .delete()
    .eq("id", scheduleId)
    .eq("project_id", projectId);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
