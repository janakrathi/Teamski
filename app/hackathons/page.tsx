import type { Metadata } from "next";

import Link from "next/link";

import Logo from "@/components/ui/Logo";

import { DAILY_MESSAGES, TRIAL_DAYS } from "@/lib/plans";

import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: { absolute: "Teamski for hackathons" },
  description:
    "A free AI teammate for every hackathon team: one shared agent per channel that researches, plans and writes while you build. Set up in five minutes.",
  alternates: { canonical: "/hackathons" },
};


// ==========================================
// THE HACKATHON GUIDE
// ==========================================
//
// One page an organiser can forward to every
// participant: what teams get, how to set up in five
// minutes, how to use it during the event, and how to
// finish for judging. Everything here is something the
// app does today; numbers come from lib/plans.ts.
//

const TRIAL_MONTHS = Math.round(TRIAL_DAYS / 30);

const CHANNELS = [
  {
    name: "ideas",
    agent: "Planner",
    use: "Brainstorm, pick an idea, and break it into tasks with owners.",
  },
  {
    name: "research",
    agent: "Research",
    use: "APIs, datasets, competitors and prior work - with links to its sources.",
  },
  {
    name: "build",
    agent: "Code review",
    use: "Connect GitHub, then ask about your code, review changes and track bugs.",
  },
  {
    name: "pitch",
    agent: "Writer",
    use: "README, demo script and slide outline, written from what you built.",
  },
];

const SETUP = [
  {
    title: "Create the project",
    body: "One person signs up and creates a project named after your team.",
  },
  {
    title: "Invite your team",
    body: "Settings → People. Add teammates by email or @username - as many as you like.",
  },
  {
    title: "Add four channels",
    body: "Pick a ready-made agent for each, using the layout below.",
  },
  {
    title: "Connect GitHub",
    body: "Settings → Connections, so the agent can read your repo and search your code.",
  },
];

const DURING = [
  "Share your brief once: post your idea, stack, the event's rules and the deadline, and say “remember this for the whole project”. Every channel's agent knows it from then on.",
  "Hand off research as a background task while you code. It keeps going if you close the tab, and you're notified when it's done.",
  "Drop in files - PDFs, docs, screenshots of a problem statement. The agent reads them.",
  "Ask “what did we decide about auth?” instead of scrolling back through chat.",
  "If two of you ask for different things, the agent points out the conflict and asks the team which to follow.",
  "Anything that changes a connected tool - opening a GitHub issue, adding rows to a sheet - waits for someone to approve it.",
];

const JUDGING = [
  "In #pitch, ask for a two-minute pitch: the problem, what you built, how it works, and what's next.",
  "Ask for a README drafted from the whole project conversation, then edit it.",
  "The project owner can download everything - every channel, message and file - from Settings → People → Export.",
];


export default function HackathonsPage() {
  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <header className="mx-auto flex max-w-[1080px] items-center gap-3 px-6 py-5">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-[14px] font-semibold"
        >
          <Logo size={24} />
          {LEGAL.service}
        </Link>

        <Link
          href="/login?mode=signup"
          className="ml-auto rounded-lg bg-[var(--text)] px-4 py-2 text-[13px] font-medium text-[var(--bg)] transition hover:opacity-90"
        >
          Create your team&apos;s project
        </Link>
      </header>


      {/* ------------------------------ */}
      {/* INTRO                          */}
      {/* ------------------------------ */}

      <section className="mx-auto max-w-[1080px] px-6 pt-10 pb-16 md:pt-16">
        <span className="rounded bg-[var(--bg-raised)] px-2 py-1 text-[11px] tracking-[0.08em] text-[var(--text-faint)] uppercase">
          Hackathon guide
        </span>

        <h1 className="mt-5 max-w-[720px] text-[36px] leading-[1.1] font-semibold tracking-[-0.03em] sm:text-[46px]">
          An AI teammate for your whole hackathon team.
        </h1>

        <p className="mt-5 max-w-[600px] text-[16px] leading-[1.6] text-[var(--text-muted)]">
          One shared AI agent in every channel. Your whole team talks to the
          same agent, it remembers your project, and it researches, plans and
          writes while you build.
        </p>

        <ul className="mt-8 grid gap-3 sm:grid-cols-3">
          {[
            ["Free for every team", "Unlimited teammates, no card."],
            [
              `Team plan free for ${TRIAL_MONTHS} months`,
              `Every new project gets it - ${DAILY_MESSAGES.team} AI messages per person per day, and connected apps.`,
            ],
            ["Nothing to install", "Works in the browser, on any laptop or phone."],
          ].map(([title, body]) => (
            <li
              key={title}
              className="rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] px-4 py-3.5"
            >
              <p className="text-[14px] font-semibold">{title}</p>

              <p className="mt-1 text-[13px] leading-[1.5] text-[var(--text-muted)]">
                {body}
              </p>
            </li>
          ))}
        </ul>
      </section>


      {/* ------------------------------ */}
      {/* SET UP                         */}
      {/* ------------------------------ */}

      <section className="border-t border-[var(--border)] bg-[var(--bg-panel)]">
        <div className="mx-auto max-w-[1080px] px-6 py-16">
          <h2 className="text-[26px] font-semibold tracking-[-0.02em]">
            Set up in five minutes
          </h2>

          <ol className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {SETUP.map((step, index) => (
              <li key={step.title}>
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-strong)] text-[13px] font-semibold">
                  {index + 1}
                </span>

                <h3 className="mt-4 text-[15px] font-semibold">{step.title}</h3>

                <p className="mt-2 text-[13.5px] leading-[1.6] text-[var(--text-muted)]">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>


      {/* ------------------------------ */}
      {/* THE CHANNELS                   */}
      {/* ------------------------------ */}

      <section className="border-t border-[var(--border)]">
        <div className="mx-auto max-w-[1080px] px-6 py-16">
          <h2 className="text-[26px] font-semibold tracking-[-0.02em]">
            The four channels we recommend
          </h2>

          <p className="mt-2 max-w-[560px] text-[14px] text-[var(--text-muted)]">
            Each channel&apos;s agent has its own job and its own memory, so
            research doesn&apos;t get mixed up with your pitch - and they all
            share one project memory for the brief and the team&apos;s decisions.
          </p>

          <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2">
            {CHANNELS.map((channel) => (
              <div key={channel.name} className="bg-[var(--bg)] p-5">
                <p className="text-[15px] font-semibold"># {channel.name}</p>

                <p className="mt-0.5 text-[12px] text-[var(--text-faint)]">
                  Agent: {channel.agent}
                </p>

                <p className="mt-2 text-[13.5px] leading-[1.55] text-[var(--text-muted)]">
                  {channel.use}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* ------------------------------ */}
      {/* DURING AND JUDGING             */}
      {/* ------------------------------ */}

      <section className="border-t border-[var(--border)] bg-[var(--bg-panel)]">
        <div className="mx-auto grid max-w-[1080px] gap-10 px-6 py-16 md:grid-cols-2">
          <div>
            <h2 className="text-[22px] font-semibold tracking-[-0.02em]">
              During the hackathon
            </h2>

            <ul className="mt-5 space-y-3">
              {DURING.map((line) => (
                <li
                  key={line}
                  className="flex gap-3 text-[13.5px] leading-[1.6] text-[var(--text-muted)]"
                >
                  <span aria-hidden="true" className="shrink-0 text-[var(--accent)]">
                    ✓
                  </span>

                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="text-[22px] font-semibold tracking-[-0.02em]">
              Before judging
            </h2>

            <ul className="mt-5 space-y-3">
              {JUDGING.map((line) => (
                <li
                  key={line}
                  className="flex gap-3 text-[13.5px] leading-[1.6] text-[var(--text-muted)]"
                >
                  <span aria-hidden="true" className="shrink-0 text-[var(--accent)]">
                    ✓
                  </span>

                  <span>{line}</span>
                </li>
              ))}
            </ul>

            <div className="mt-8 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3.5">
              <p className="text-[13.5px] font-semibold">Play fair</p>

              <p className="mt-1 text-[13px] leading-[1.6] text-[var(--text-muted)]">
                Follow your event&apos;s rules on AI, and make sure your team
                understands everything you submit. Check facts, numbers and
                links - the AI can be wrong.
              </p>
            </div>
          </div>
        </div>
      </section>


      {/* ------------------------------ */}
      {/* START, AND ORGANISERS          */}
      {/* ------------------------------ */}

      <section className="border-t border-[var(--border)]">
        <div className="mx-auto flex max-w-[1080px] flex-col gap-8 px-6 py-16 md:flex-row md:items-center">
          <div className="flex-1">
            <h2 className="text-[24px] font-semibold tracking-[-0.02em]">
              Ready when your team is.
            </h2>

            <p className="mt-1 text-[14px] text-[var(--text-muted)]">
              Create the project, invite your team, and give your first
              channel a job.
            </p>

            <Link
              href="/login?mode=signup"
              className="mt-5 inline-block rounded-lg bg-[var(--text)] px-5 py-2.5 text-[14px] font-medium text-[var(--bg)] transition hover:opacity-90"
            >
              Create your team&apos;s project
            </Link>
          </div>

          <div className="rounded-xl border border-[var(--border-strong)] bg-[var(--bg-panel)] p-5 md:max-w-[380px]">
            <p className="text-[14px] font-semibold">Running a hackathon?</p>

            <p className="mt-1.5 text-[13px] leading-[1.6] text-[var(--text-muted)]">
              We&apos;re happy to give a short demo at your kickoff and help your
              participants get set up. Email{" "}
              <a
                href={`mailto:${LEGAL.contactEmail}?subject=Teamski%20at%20our%20hackathon`}
                className="text-[var(--text)] underline underline-offset-2"
              >
                {LEGAL.contactEmail}
              </a>
              .
            </p>
          </div>
        </div>
      </section>


      <footer className="border-t border-[var(--border)]">
        <div className="mx-auto flex max-w-[1080px] flex-wrap items-center gap-x-5 gap-y-3 px-6 py-8 text-[12.5px] text-[var(--text-faint)]">
          <Link href="/" className="hover:text-[var(--text-muted)]">
            Teamski home
          </Link>

          <Link href="/security" className="hover:text-[var(--text-muted)]">
            Security &amp; data
          </Link>

          <Link href="/privacy" className="hover:text-[var(--text-muted)]">
            Privacy Policy
          </Link>
        </div>
      </footer>
    </main>
  );
}
