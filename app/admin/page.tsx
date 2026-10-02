import type { Metadata } from "next";

import Link from "next/link";

import { notFound } from "next/navigation";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

import { adminClient } from "@/lib/supabase/admin";

import { WINDOW_DAYS, load } from "@/lib/admin/load";

import { PLAN_LABELS, type Plan } from "@/lib/plans";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Usage · Teamski",
  robots: { index: false, follow: false },
};


// ==========================================
// USAGE
// ==========================================
//
// For whoever runs Teamski, and nobody else. Only
// email addresses listed in ADMIN_EMAILS can open
// it; everyone else gets the same 404 as a page
// that does not exist, so its existence is not
// advertised either.
//
// Read with the service role, because it counts
// across every account. Nothing here leaves the
// server except the numbers on the page.
//



function isAdmin(email: string | null | undefined) {
  const allowed = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  return Boolean(email) && allowed.includes(email!.toLowerCase());
}


export default async function AdminPage() {
  const session = await createClient();

  const {
    data: { user },
  } = await session.auth.getUser();

  if (!user || !isAdmin(user.email)) {
    notFound();
  }

  const db = adminClient() as unknown as SupabaseClient | null;

  if (!db) {
    return (
      <Shell>
        <p className="text-[14px] text-[var(--text-muted)]">
          SUPABASE_SERVICE_ROLE_KEY is not set on this server, so there is
          nothing to count with.
        </p>
      </Shell>
    );
  }

  const { summary: s, plans, connections } = await load(db);

  const percent = (part: number, whole: number) =>
    whole === 0 ? "–" : `${Math.round((part / whole) * 100)}%`;

  return (
    <Shell>
      {/* ---------------------------- */}
      {/* HEADLINES                    */}
      {/* ---------------------------- */}

      <Section title="People">
        <Tiles>
          <Tile label="Signed up" value={s.users.total} note={`${s.users.newThisWeek} this week`} />
          <Tile label="Active this week" value={s.users.activeThisWeek} note="sent a message or started a task" />
          <Tile label="Joined through an invite" value={s.users.viaInvite} note={percent(s.users.viaInvite, s.users.total) + " of everyone"} />
          <Tile
            label="Came back after a week"
            value={percent(s.retention.day7.returned, s.retention.day7.eligible)}
            note={`${s.retention.day7.returned} of ${s.retention.day7.eligible} · after a day: ${percent(
              s.retention.day1.returned,
              s.retention.day1.eligible
            )}`}
          />
        </Tiles>
      </Section>

      <Section title="Teams">
        <Tiles>
          <Tile label="Projects" value={s.projects.total} note={`${s.projects.teamProjects} with 2 or more people`} />
          <Tile label="Active projects" value={s.projects.activeThisWeek} note="this week" />
          <Tile label="Active teams" value={s.projects.activeTeams} note="2 or more people active this week" />
          <Tile
            label="Invites"
            value={s.invites.total}
            note={`${s.invites.accepted} accepted (${percent(s.invites.accepted, s.invites.total)}) · ${s.invites.sentThisWeek} this week`}
          />
        </Tiles>
      </Section>

      <Section title="This week">
        <Tiles>
          <Tile label="Messages sent" value={s.actions.messagesThisWeek} note="channels and DMs" />
          <Tile label="Agent replies" value={s.actions.agentRepliesThisWeek} />
          <Tile label="Background tasks" value={s.actions.agentTasksThisWeek} />
          <Tile
            label="Paid plans"
            value={plans.reduce((total, [, n]) => total + n, 0)}
            note={
              plans.length === 0
                ? "everyone is on Free"
                : plans
                    .map(([plan, n]) => `${n} ${PLAN_LABELS[plan as Plan] ?? plan}`)
                    .join(" · ")
            }
          />
          <Tile
            label="Coming-back nudges"
            value={s.nudges.thisWeek}
            note={`${s.nudges.total} sent · ${s.nudges.returned} came back${
              s.nudges.total
                ? ` (${percent(s.nudges.returned, s.nudges.total)})`
                : ""
            }`}
          />
        </Tiles>
      </Section>


      {/* ---------------------------- */}
      {/* LAST 30 DAYS                 */}
      {/* ---------------------------- */}

      <Section title="Last 30 days">
        <div className="grid gap-4 lg:grid-cols-3">
          <Bars title="Signups" data={s.charts.signups} />
          <Bars title="People active" data={s.charts.activePeople} distinct />
          <Bars title="Messages sent" data={s.charts.messages} />
          <Bars title="Coming-back nudges" data={s.charts.nudges} />
          <Bars title="Came back from a nudge" data={s.charts.nudgeReturns} />
        </div>
      </Section>


      <Section title="Connected">
        <p className="text-[13.5px] text-[var(--text-muted)]">
          Google {connections.google} · GitHub {connections.github} · own
          model keys {connections.modelKeys} · apps over MCP{" "}
          {connections.apps}
        </p>
      </Section>


      {/* ---------------------------- */}
      {/* WHO                          */}
      {/* ---------------------------- */}

      <Section title="Latest signups">
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="text-[11px] tracking-[0.06em] text-[var(--text-faint)] uppercase">
              <tr className="border-b border-[var(--border)]">
                <th className="px-4 py-2.5 font-normal">Person</th>
                <th className="px-4 py-2.5 font-normal">Joined</th>
                <th className="px-4 py-2.5 font-normal">How</th>
                <th className="px-4 py-2.5 text-right font-normal">Projects</th>
                <th className="px-4 py-2.5 text-right font-normal">Actions</th>
                <th className="px-4 py-2.5 font-normal">Last active</th>
              </tr>
            </thead>

            <tbody>
              {s.recent.map((person) => (
                <tr
                  key={person.id}
                  className="border-b border-[var(--border)] last:border-0"
                >
                  <td className="px-4 py-2.5">
                    <span className="block text-[var(--text)]">
                      {person.name || person.email || "—"}
                    </span>

                    {person.name && person.email && (
                      <span className="block text-[12px] text-[var(--text-faint)]">
                        {person.email}
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-2.5 text-[var(--text-muted)] tabular-nums">
                    {formatWhen(person.createdAt)}
                  </td>

                  <td className="px-4 py-2.5 text-[var(--text-muted)]">
                    {person.viaInvite ? "Invited" : "Signed up"}
                  </td>

                  <td className="px-4 py-2.5 text-right text-[var(--text-muted)] tabular-nums">
                    {person.projects}
                  </td>

                  <td className="px-4 py-2.5 text-right text-[var(--text-muted)] tabular-nums">
                    {person.actions}
                  </td>

                  <td className="px-4 py-2.5 text-[var(--text-muted)] tabular-nums">
                    {person.lastActive ? formatWhen(person.lastActive) : "never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-2 text-[12px] text-[var(--text-faint)]">
          Actions are messages and agent tasks in the last {WINDOW_DAYS}{" "}
          days. Reading does not count, so &quot;never&quot; can mean they
          only looked.
        </p>
      </Section>
    </Shell>
  );
}


// ==========================================
// PIECES
// ==========================================

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}


function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[var(--bg)] px-6 py-10 text-[var(--text)]">
      <div className="mx-auto max-w-[1080px]">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[22px] font-semibold tracking-[-0.01em]">
            Usage
          </h1>

          <span className="text-[12.5px] text-[var(--text-faint)]">
            Only visible to admins · days in India time
          </span>

          <Link
            href="/"
            className="ml-auto text-[13px] text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            Back to Teamski
          </Link>
        </div>

        <div className="mt-8 space-y-10">{children}</div>
      </div>
    </main>
  );
}


function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 text-[11px] tracking-[0.12em] text-[var(--text-faint)] uppercase">
        {title}
      </h2>

      {children}
    </section>
  );
}


function Tiles({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>
  );
}


function Tile({
  label,
  value,
  note,
}: {
  label: string;
  value: number | string;
  note?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] px-4 py-3.5">
      <p className="text-[12.5px] text-[var(--text-muted)]">{label}</p>

      <p className="mt-1 text-[28px] leading-none font-semibold tracking-[-0.02em] tabular-nums">
        {value}
      </p>

      {note && (
        <p className="mt-2 text-[11.5px] leading-snug text-[var(--text-faint)]">
          {note}
        </p>
      )}
    </div>
  );
}


// One series, so no legend: the title names it.
// Thin bars with a rounded top, a 2px gap between
// them, and a hover tooltip on each. The ink is the
// app's text colour, which reads on its dark
// surface; the numbers themselves stay in text
// tokens.

function Bars({
  title,
  data,
  distinct = false,
}: {
  title: string;
  data: { day: string; count: number }[];

  // Counts of people per day do not add up - the
  // same person is in many days - so no total.
  distinct?: boolean;
}) {
  const width = 300;
  const height = 110;
  const gap = 2;

  const max = Math.max(1, ...data.map((point) => point.count));

  const bar = (width - gap * (data.length - 1)) / data.length;

  const total = data.reduce((sum, point) => sum + point.count, 0);

  const label = (day: string) =>
    new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${day}T00:00:00Z`));

  return (
    <figure className="rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] px-4 py-3.5">
      <figcaption className="flex items-baseline gap-2">
        <span className="text-[12.5px] text-[var(--text-muted)]">{title}</span>

        <span className="ml-auto text-[12.5px] text-[var(--text)] tabular-nums">
          {distinct
            ? `busiest day ${total === 0 ? 0 : max}`
            : `${total} total · busiest day ${total === 0 ? 0 : max}`}
        </span>
      </figcaption>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="mt-3 block h-[110px] w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${title}, last 30 days, ${total} total`}
      >
        <line
          x1="0"
          x2={width}
          y1={height - 0.5}
          y2={height - 0.5}
          stroke="var(--border-strong)"
          strokeWidth="1"
        />

        {data.map((point, index) => {
          const h = point.count === 0 ? 0 : Math.max(3, (point.count / max) * (height - 4));
          const x = index * (bar + gap);
          const r = Math.min(2, bar / 2, h);

          return (
            <g key={point.day}>
              {/* The whole column is the hover target, not just the bar. */}
              <rect x={x} y={0} width={bar} height={height} fill="transparent">
                <title>{`${label(point.day)}: ${point.count}`}</title>
              </rect>

              {h > 0 && (
                <path
                  d={`M${x},${height} V${height - h + r} Q${x},${height - h} ${x + r},${height - h} H${x + bar - r} Q${x + bar},${height - h} ${x + bar},${height - h + r} V${height} Z`}
                  fill="var(--text-muted)"
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })}
      </svg>

      <div className="mt-1.5 flex justify-between text-[11px] text-[var(--text-faint)] tabular-nums">
        <span>{label(data[0].day)}</span>
        <span>{label(data[data.length - 1].day)}</span>
      </div>
    </figure>
  );
}
