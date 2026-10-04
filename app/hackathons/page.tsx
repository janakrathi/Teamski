import type { Metadata } from "next";

import Link from "next/link";

import { DAILY_MESSAGES, TRIAL_DAYS } from "@/lib/plans";

import ContactUs from "@/components/landing/ContactUs";

import Reveal from "@/components/landing/Reveal";

import Backdrop from "@/components/landing/Backdrop";

import {
  CONTAINER,
  EYEBROW,
  H1,
  H2,
  PRIMARY,
  SECONDARY,
  SITE_THEME,
  SiteFooter,
  SiteHeader,
  at,
} from "@/components/landing/Site";

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
    <main style={SITE_THEME} className="relative isolate min-h-screen shrink-0 overflow-x-clip text-[#ededed]">
      {/* Black, a muted drifting colour and the signal
          lines, behind the whole page. */}
      <Backdrop />

      {/* ------------------------------ */}
      {/* INTRO                          */}
      {/* ------------------------------ */}

      <section className="relative isolate flex min-h-[max(600px,92svh)] flex-col overflow-hidden">

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_55%_at_18%_55%,rgba(0,0,0,0.35),transparent_70%)]"
        />

        <SiteHeader />

        <div className={`${CONTAINER} relative flex flex-1 flex-col justify-center pt-10 pb-20`}>
          <p style={at(0)} className={`t-text-reveal ${EYEBROW}`}>
            Hackathon guide
          </p>

          <h1 style={at(1)} className={`t-text-reveal mt-5 max-w-[800px] ${H1}`}>
            An AI teammate{" "}
            <span className="text-white/60">for your whole hackathon team.</span>
          </h1>

          <p style={at(2)} className="t-text-reveal mt-6 max-w-[520px] text-[16px] leading-[1.6] text-white/60">
            One shared AI agent in every channel. Your whole team talks to the
            same agent, it remembers your project, and it researches, plans and
            writes while you build.
          </p>

          <div style={at(3)} className="t-text-reveal mt-9 flex flex-wrap gap-3">
            <Link href="/login?mode=signup" className={PRIMARY}>
              Create your team&apos;s project
            </Link>

            <Link href="#setup" className={SECONDARY}>
              Set up in five minutes
            </Link>
          </div>
        </div>
      </section>

      <section className="lp-section">
        <Reveal className={`${CONTAINER} grid md:grid-cols-3`}>
          {[
            ["Free for every team", "Unlimited teammates, no card."],
            [
              `Team plan free for ${TRIAL_MONTHS} months`,
              `Every new project gets it - ${DAILY_MESSAGES.team} AI messages per person per day, and connected apps.`,
            ],
            ["Nothing to install", "Works in the browser, on any laptop or phone."],
          ].map(([title, body], index) => (
            <div
              key={title}
              style={at(index)}
              className={`t-reveal-card border-b border-white/10 py-8 md:border-b-0 ${
                index < 2 ? "md:border-r md:pr-8" : ""
              } ${index > 0 ? "md:pl-8" : ""}`}
            >
              <p className="text-[16px] font-[450]">{title}</p>

              <p className="mt-1.5 text-[14.5px] leading-[1.6] text-white/55">
                {body}
              </p>
            </div>
          ))}
        </Reveal>
      </section>


      {/* ------------------------------ */}
      {/* SET UP                         */}
      {/* ------------------------------ */}

      <section id="setup" className="scroll-mt-6 lp-section">
        <span aria-hidden="true" className="lp-ambient" style={{ top: "20%" }} />

        <div className={`${CONTAINER} py-20 sm:py-28`}>
          <Reveal>
            <h2 className={`t-reveal-item ${H2}`}>
              Set up{" "}
              <span className="text-white/60">in five minutes.</span>
            </h2>
          </Reveal>

          <Reveal clear className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
            {SETUP.map((step, index) => (
              <div key={step.title} style={at(index)} className="t-reveal-card lp-card bg-black p-6">
                <span className="text-[34px] leading-none font-light tracking-[-0.03em] text-white/25 tabular-nums">
                  0{index + 1}
                </span>

                <h3 className="mt-6 text-[16px] font-[450]">{step.title}</h3>

                <p className="mt-2 text-[14.5px] leading-[1.6] text-white/55">
                  {step.body}
                </p>
              </div>
            ))}
          </Reveal>
        </div>
      </section>


      {/* ------------------------------ */}
      {/* THE CHANNELS                   */}
      {/* ------------------------------ */}

      <section className="lp-section">
        <div className={`${CONTAINER} py-20 sm:py-28`}>
          <Reveal className="grid gap-5">
            <h2 className={`t-reveal-item ${H2}`}>
              The four channels{" "}
              <span className="text-white/60">we recommend.</span>
            </h2>

            <p style={at(1)} className="t-reveal-item max-w-[640px] text-[15px] leading-[1.65] text-white/60">
              Each channel&apos;s agent has its own job and its own memory, so
              research doesn&apos;t get mixed up with your pitch - and they all
              share one project memory for the brief and the team&apos;s decisions.
            </p>
          </Reveal>

          <div className="mt-14 grid border-t border-white/10 sm:grid-cols-2">
            {CHANNELS.map((channel, index) => (
              <Reveal
                key={channel.name}
                className={`border-b border-white/10 py-8 ${
                  index % 2 === 0 ? "sm:border-r sm:pr-8" : "sm:pl-8"
                }`}
              >
                <p className="t-reveal-item text-[22px] font-[450] tracking-[-0.015em]">
                  # {channel.name}
                </p>

                <p style={at(1)} className="t-reveal-item mt-1 flex items-center gap-2 text-[12.5px] text-white/40">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                  {channel.agent}
                </p>

                <p style={at(2)} className="t-reveal-item mt-3 max-w-[440px] text-[14.5px] leading-[1.6] text-white/55">
                  {channel.use}
                </p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>


      {/* ------------------------------ */}
      {/* DURING AND JUDGING             */}
      {/* ------------------------------ */}

      <section className="lp-section">
        <div className={`${CONTAINER} grid md:grid-cols-2`}>
          <Reveal className="border-b border-white/10 py-20 md:border-r md:border-b-0 md:pr-10 sm:py-28">
            <h2 className={`t-reveal-item ${H2}`}>
              During{" "}
              <span className="text-white/60">the hackathon.</span>
            </h2>

            <ul className="mt-8 space-y-4">
              {DURING.map((line, index) => (
                <li
                  key={line}
                  style={at(index + 1)}
                  className="t-reveal-item flex gap-3 text-[14.5px] leading-[1.6] text-white/60"
                >
                  <span aria-hidden="true" className="shrink-0 text-[var(--accent)]">
                    ✓
                  </span>

                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal className="py-20 md:pl-10 sm:py-28">
            <h2 className={`t-reveal-item ${H2}`}>
              Before{" "}
              <span className="text-white/60">judging.</span>
            </h2>

            <ul className="mt-8 space-y-4">
              {JUDGING.map((line, index) => (
                <li
                  key={line}
                  style={at(index + 1)}
                  className="t-reveal-item flex gap-3 text-[14.5px] leading-[1.6] text-white/60"
                >
                  <span aria-hidden="true" className="shrink-0 text-[var(--accent)]">
                    ✓
                  </span>

                  <span>{line}</span>
                </li>
              ))}
            </ul>

            <div data-signal-clear style={at(JUDGING.length + 1)} className="t-reveal-card lp-card mt-10 rounded-2xl border border-white/10 bg-[#050505] px-5 py-4">
              <p className="text-[16px] font-[450]">Play fair</p>

              <p className="mt-1.5 text-[14.5px] leading-[1.6] text-white/55">
                Follow your event&apos;s rules on AI, and make sure your team
                understands everything you submit. Check facts, numbers and
                links - the AI can be wrong.
              </p>
            </div>
          </Reveal>
        </div>
      </section>


      {/* ------------------------------ */}
      {/* START, AND ORGANISERS          */}
      {/* ------------------------------ */}

      <section className="relative isolate overflow-hidden lp-section">

        <Reveal className={`${CONTAINER} relative flex min-h-[460px] flex-col items-center justify-center py-24 text-center`}>
          <h2 className="t-reveal-item text-[40px] leading-[1.05] font-[450] tracking-[-0.035em] sm:text-[56px]">
            Ready when your team is.
          </h2>

          <p style={at(1)} className="t-reveal-item mt-4 max-w-[440px] text-[15px] leading-[1.6] text-white/60">
            Create the project, invite your team, and give your first
            channel a job.
          </p>

          <div style={at(2)} className="t-reveal-item mt-8">
            <Link href="/login?mode=signup" className={PRIMARY}>
              Create your team&apos;s project
            </Link>
          </div>

          <div style={at(3)} data-signal-clear className="t-reveal-card lp-card mt-12 max-w-[440px] rounded-2xl border border-white/10 bg-black/85 p-5 text-left">
            <p className="text-[16px] font-[450]">Running a hackathon?</p>

            <p className="mt-1.5 text-[14.5px] leading-[1.6] text-white/55">
              We&apos;re happy to give a short demo at your kickoff and help your
              participants get set up.{" "}
              <ContactUs
                label="Get in touch"
                topic="Partnership or hackathon"
                className="text-[#ededed] underline decoration-white/30 underline-offset-4"
              />
              .
            </p>
          </div>
        </Reveal>
      </section>

      <SiteFooter />
    </main>
  );
}
