// ==========================================
// HOW TEAMSKI IS BEING USED
// ==========================================
//
// Pure arithmetic over rows already fetched, so
// every number on the admin page can be tested
// without a database.
//
// "Active" means doing something: sending a
// message in a channel or DM, or starting an agent
// task. Opening the app and reading does not
// count - there is no record of it, and a number
// that guesses is worse than one that undercounts.
//
// Days are Indian days, since that is where the
// person reading this is.
//

export type UserRow = {
  id: string;
  email: string | null;
  name: string | null;
  createdAt: string;
};

export type Membership = {
  projectId: string;
  userId: string;
  role: string;
};

export type ProjectRow = {
  id: string;
  name: string;
  createdAt: string;
};

export type Activity = {
  userId: string | null;
  projectId: string | null;
  at: string;
  kind: "message" | "dm" | "agent-task" | "agent-reply";
};

export type InviteRow = {
  createdAt: string;
  acceptedAt: string | null;
};

const DAY = 86_400_000;

const TIME_ZONE = "Asia/Kolkata";

const dayKey = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function dayOf(iso: string | number | Date) {
  return dayKey.format(new Date(iso));
}


// The last n days, oldest first, each with a
// count - including the empty ones, which a chart
// has to show as zero rather than skip.

export function perDay(
  times: string[],
  days: number,
  now = Date.now()
) {
  const counts = new Map<string, number>();

  for (let n = days - 1; n >= 0; n--) {
    counts.set(dayOf(now - n * DAY), 0);
  }

  for (const time of times) {
    const key = dayOf(time);

    if (counts.has(key)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return [...counts.entries()].map(([day, count]) => ({
    day,
    count,
  }));
}


function since(iso: string, ms: number, now: number) {
  return new Date(iso).getTime() >= now - ms;
}


// A human did it. Agent replies are output, not
// usage.

function isHuman(activity: Activity) {
  return activity.kind !== "agent-reply" && activity.userId;
}


export function summarise(input: {
  users: UserRow[];
  memberships: Membership[];
  projects: ProjectRow[];
  activity: Activity[];
  invites: InviteRow[];

  // Each coming-back nudge that was sent: who it went to
  // and when (profiles.id + winback_sent_at). Absent on a
  // database without that column, which just draws empty
  // bars. The user id is what lets us tell whether they
  // then came back.
  nudges?: { userId: string; at: string }[];

  now?: number;
}) {
  const now = input.now ?? Date.now();

  const nudges = input.nudges ?? [];

  const human = input.activity.filter(isHuman);

  const week = 7 * DAY;

  // --------------------------------------
  // PEOPLE
  // --------------------------------------

  const activeThisWeek = new Set(
    human
      .filter((item) => since(item.at, week, now))
      .map((item) => item.userId as string)
  );

  // Joined somebody else's project rather than
  // starting their own: the invite loop working.

  const invited = new Set(
    input.memberships
      .filter((member) => member.role !== "owner")
      .map((member) => member.userId)
  );

  const owners = new Set(
    input.memberships
      .filter((member) => member.role === "owner")
      .map((member) => member.userId)
  );

  const viaInvite = input.users.filter(
    (user) => invited.has(user.id) && !owners.has(user.id)
  ).length;

  // --------------------------------------
  // PROJECTS AND TEAMS
  // --------------------------------------

  const membersOf = new Map<string, number>();

  for (const member of input.memberships) {
    membersOf.set(
      member.projectId,
      (membersOf.get(member.projectId) ?? 0) + 1
    );
  }

  const activePeopleIn = new Map<string, Set<string>>();

  for (const item of human) {
    if (!item.projectId || !since(item.at, week, now)) {
      continue;
    }

    const people = activePeopleIn.get(item.projectId) ?? new Set();

    people.add(item.userId as string);

    activePeopleIn.set(item.projectId, people);
  }

  const teamProjects = [...membersOf.values()].filter(
    (count) => count >= 2
  ).length;

  // A team is using it when at least two of its
  // people did something this week - one person
  // alone in a shared project is still a solo user.

  const activeTeams = [...activePeopleIn.values()].filter(
    (people) => people.size >= 2
  ).length;

  // --------------------------------------
  // COMING BACK
  // --------------------------------------
  //
  // Of the people old enough to have had the
  // chance, how many did something again at least
  // a day - or a week - after signing up.
  //

  const activityBy = new Map<string, number[]>();

  for (const item of human) {
    const list = activityBy.get(item.userId as string) ?? [];

    list.push(new Date(item.at).getTime());

    activityBy.set(item.userId as string, list);
  }

  function returned(after: number) {
    const eligible = input.users.filter(
      (user) => new Date(user.createdAt).getTime() <= now - after
    );

    const came = eligible.filter((user) => {
      const joined = new Date(user.createdAt).getTime();

      return (activityBy.get(user.id) ?? []).some(
        (time) => time >= joined + after
      );
    });

    return { returned: came.length, eligible: eligible.length };
  }

  // --------------------------------------
  // CAME BACK FROM A NUDGE
  // --------------------------------------
  //
  // Of the people we emailed, how many then did
  // something - a message, a DM, a task - after the
  // email went out. Counted by the day they came back,
  // so the chart lines up returns with the sends that
  // (plausibly) earned them. Attribution, not proof: we
  // credit the email with the return, which is honest
  // enough for a nudge that only lands on the dormant.

  const nudgeReturnDays: string[] = [];

  for (const nudge of nudges) {
    const sentAt = new Date(nudge.at).getTime();

    const first = (activityBy.get(nudge.userId) ?? [])
      .filter((time) => time > sentAt)
      .sort((a, b) => a - b)[0];

    if (first) {
      nudgeReturnDays.push(new Date(first).toISOString());
    }
  }

  // --------------------------------------
  // RECENT SIGNUPS
  // --------------------------------------

  const recent = [...input.users]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 30)
    .map((user) => {
      const theirs = human.filter((item) => item.userId === user.id);

      return {
        ...user,
        viaInvite: invited.has(user.id) && !owners.has(user.id),
        projects: input.memberships.filter(
          (member) => member.userId === user.id
        ).length,
        actions: theirs.length,
        lastActive: theirs.reduce<string | null>(
          (latest, item) =>
            !latest || item.at > latest ? item.at : latest,
          null
        ),
      };
    });

  const accepted = input.invites.filter((invite) => invite.acceptedAt);

  return {
    users: {
      total: input.users.length,
      newThisWeek: input.users.filter((user) =>
        since(user.createdAt, week, now)
      ).length,
      activeThisWeek: activeThisWeek.size,
      viaInvite,
    },

    projects: {
      total: input.projects.length,
      teamProjects,
      activeThisWeek: activePeopleIn.size,
      activeTeams,
    },

    actions: {
      messagesThisWeek: human.filter(
        (item) =>
          (item.kind === "message" || item.kind === "dm") &&
          since(item.at, week, now)
      ).length,
      agentTasksThisWeek: human.filter(
        (item) => item.kind === "agent-task" && since(item.at, week, now)
      ).length,
      agentRepliesThisWeek: input.activity.filter(
        (item) => item.kind === "agent-reply" && since(item.at, week, now)
      ).length,
    },

    invites: {
      sentThisWeek: input.invites.filter((invite) =>
        since(invite.createdAt, week, now)
      ).length,
      total: input.invites.length,
      accepted: accepted.length,
    },

    // Coming-back nudges: the one-time emails to people
    // who signed up and went quiet, and how many of them
    // then came back.
    nudges: {
      total: nudges.length,
      thisWeek: nudges.filter((nudge) =>
        since(nudge.at, week, now)
      ).length,
      returned: nudgeReturnDays.length,
    },

    retention: {
      day1: returned(DAY),
      day7: returned(week),
    },

    charts: {
      signups: perDay(
        input.users.map((user) => user.createdAt),
        30,
        now
      ),
      messages: perDay(
        human
          .filter((item) => item.kind === "message" || item.kind === "dm")
          .map((item) => item.at),
        30,
        now
      ),
      activePeople: perDayDistinct(human, 30, now),
      nudges: perDay(
        nudges.map((nudge) => nudge.at),
        30,
        now
      ),
      nudgeReturns: perDay(nudgeReturnDays, 30, now),
    },

    recent,
  };
}


// People who did anything, per day.

function perDayDistinct(
  activity: Activity[],
  days: number,
  now: number
) {
  const people = new Map<string, Set<string>>();

  for (let n = days - 1; n >= 0; n--) {
    people.set(dayOf(now - n * DAY), new Set());
  }

  for (const item of activity) {
    people.get(dayOf(item.at))?.add(item.userId as string);
  }

  return [...people.entries()].map(([day, set]) => ({
    day,
    count: set.size,
  }));
}


export type Summary = ReturnType<typeof summarise>;
