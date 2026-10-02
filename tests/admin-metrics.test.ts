import { test } from "node:test";

import assert from "node:assert/strict";

import { dayOf, perDay, summarise } from "../lib/admin/metrics.ts";


const NOW = Date.parse("2026-09-14T12:00:00+05:30");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();


test("days with nothing still appear as zero", () => {
  const days = perDay([ago(0), ago(0), ago(2)], 5, NOW);

  assert.equal(days.length, 5);
  assert.deepEqual(
    days.map((d) => d.count),
    [0, 0, 1, 0, 2]
  );
  assert.equal(days[4].day, dayOf(NOW));
});


test("the day is India's, not UTC's", () => {
  // 23:30 UTC on the 13th is 05:00 on the 14th in India.
  assert.equal(dayOf("2026-09-13T23:30:00Z"), "2026-09-14");
});


test("teams, invites and coming back are counted from what people did", () => {
  const s = summarise({
    now: NOW,

    users: [
      { id: "riya", email: "r@x.in", name: "Riya", createdAt: ago(20) },
      { id: "aman", email: "a@x.in", name: null, createdAt: ago(10) },
      { id: "sam", email: "s@x.in", name: null, createdAt: ago(1.5) },
      { id: "new", email: "n@x.in", name: null, createdAt: ago(0.2) },
    ],

    memberships: [
      { projectId: "p1", userId: "riya", role: "owner" },
      { projectId: "p1", userId: "aman", role: "member" },
      { projectId: "p2", userId: "sam", role: "owner" },
    ],

    projects: [
      { id: "p1", name: "Launch", createdAt: ago(20) },
      { id: "p2", name: "Solo", createdAt: ago(1) },
    ],

    activity: [
      // Riya and Aman both active in p1 this week: a team.
      { userId: "riya", projectId: "p1", at: ago(1), kind: "message" },
      { userId: "aman", projectId: "p1", at: ago(2), kind: "agent-task" },
      // Aman came back more than a week after signing up.
      { userId: "aman", projectId: "p1", at: ago(0.5), kind: "message" },
      // Sam only on the first day.
      { userId: "sam", projectId: "p2", at: ago(1.4), kind: "message" },
      // Agent replies are not people.
      { userId: null, projectId: "p1", at: ago(1), kind: "agent-reply" },
    ],

    invites: [
      { createdAt: ago(10), acceptedAt: ago(10) },
      { createdAt: ago(3), acceptedAt: null },
    ],
  });

  assert.equal(s.users.total, 4);
  assert.equal(s.users.newThisWeek, 2);
  assert.equal(s.users.activeThisWeek, 3);
  assert.equal(s.users.viaInvite, 1);

  assert.equal(s.projects.teamProjects, 1);
  assert.equal(s.projects.activeTeams, 1);
  assert.equal(s.projects.activeThisWeek, 2);

  assert.equal(s.actions.agentRepliesThisWeek, 1);
  assert.equal(s.actions.messagesThisWeek, 3);

  assert.deepEqual(s.invites, { sentThisWeek: 1, total: 2, accepted: 1 });

  // After a week: Riya and Aman were old enough; Aman came back (0.5 days
  // ago is >= 7 days after joining 10 days ago), Riya's last action was
  // 1 day ago, 19 days after joining - also back.
  assert.deepEqual(s.retention.day7, { returned: 2, eligible: 2 });

  // After a day: Sam joined 1.5 days ago and only acted 0.1 days after.
  assert.deepEqual(s.retention.day1, { returned: 2, eligible: 3 });

  assert.equal(s.recent[0].id, "new");
  assert.equal(s.recent[0].lastActive, null);
});
