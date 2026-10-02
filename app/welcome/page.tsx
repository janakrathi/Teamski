import type { Metadata } from "next";

import Link from "next/link";

import Logo from "@/components/ui/Logo";

import BrandIcon from "@/components/ui/BrandIcon";

import { CATALOG } from "@/lib/mcp/catalog";

import { LEGAL } from "@/lib/legal";

import PlanCards from "@/components/plans/PlanCards";

import ConnectionsOrbit from "@/components/landing/ConnectionsOrbit";

import ContactUs from "@/components/landing/ContactUs";

import { DAILY_MESSAGES, TEAM_PRICE_INR } from "@/lib/plans";

export const metadata: Metadata = {
  // The landing page names itself in full rather
  // than borrowing the "· Teamski" suffix.
  title: {
    absolute:
      "Teamski — a shared AI teammate for your whole team",
  },
  // Leads with the name, so a search for "Teamski" can
  // tell this apart from every "team ski" on the web.
  description:
    "Teamski is a shared AI workspace for teams: one AI agent per channel, shared memory, background tasks, and apps like GitHub, Notion and Linear. Free to start.",

  // "/" is the front door people type and Google checks;
  // this page is what it shows signed-out visitors. One
  // address for both, or they compete with each other.
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title:
      "Teamski — a shared AI teammate for your whole team",
    description:
      "Teamski is a shared AI workspace for teams: one AI agent per channel, shared memory, background tasks, and apps like GitHub, Notion and Linear. Free to start.",
    url: "/",
    type: "website",
  },
};


// ------------------------------------------
// WHAT TEAMSKI IS, FOR SEARCH ENGINES
// ------------------------------------------
//
// Structured data naming the organisation, the site and
// the product, so "Teamski" is understood as one thing -
// not the words "team" and "ski". Prices from the same
// table the app charges.

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://teamski.in";

const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE}/#organization`,
      name: "Teamski",
      alternateName: ["Teamski AI", "teamski.in"],
      url: `${SITE}/`,
      logo: `${SITE}/apple-icon.png`,
      founder: { "@type": "Person", name: "Janak Rathi" },
    },
    {
      "@type": "WebSite",
      "@id": `${SITE}/#website`,
      name: "Teamski",
      url: `${SITE}/`,
      publisher: { "@id": `${SITE}/#organization` },
    },
    {
      "@type": "SoftwareApplication",
      name: "Teamski",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: `${SITE}/`,
      description:
        "A shared AI workspace for teams: one AI agent per channel that the whole team talks to, with shared memory, background tasks and connected apps.",
      publisher: { "@id": `${SITE}/#organization` },
      offers: [
        { "@type": "Offer", name: "Free", price: "0", priceCurrency: "INR" },
        {
          "@type": "Offer",
          name: "Team",
          price: String(TEAM_PRICE_INR.INR.base),
          priceCurrency: "INR",
        },
      ],
    },
  ],
};


// ==========================================
// THE FRONT DOOR
// ==========================================
//
// What somebody who has never heard of Teamski
// sees at teamski.in - and what Google looks at
// when it checks the app is real. Signed-in
// people never land here; the proxy sends them
// straight to their workspace.
//
// Every sentence describes something the app
// does today. No "secure", no "private", no
// "guaranteed": the same rule as the legal pages.
//

const FEATURES = [
  {
    title: "A channel, an agent",
    body: "Every channel has its own AI agent with its own instructions and memory. #research searches the web and cites sources; #meetings turns notes into action items.",
  },
  {
    title: "Work that keeps going",
    body: "Hand an agent a task and close the tab. It works in the background, and you can pause it, stop it or pick it back up.",
  },
  {
    title: "Ready-made agents",
    body: "Start a channel as Meeting notes, Research, Writer, Planner, Bug triage or Reports, or write the instructions yourself.",
  },
  {
    title: "Your tools, connected",
    body: "Google Sheets, GitHub, Notion, Linear, Jira & Confluence, Asana, Sentry and more. Agents act as you, with the access your account has.",
  },
  {
    title: "Changes wait for you",
    body: "Agents ask before changing anything in a connected app and before deleting files. You see what they want to do, and you decide.",
  },
  {
    title: "Pick the model",
    body: "Built-in AI on every plan, nothing to set up. Add a free Google Gemini key on any plan for faster answers, or on Team bring Claude, ChatGPT or Grok and share one key with the project.",
  },
];

// Every app Teamski connects to today: the two
// built-in connections, then the MCP catalog.
// Read from the catalog, so a new entry there
// shows up here too.

const APPS = [
  { id: "google", name: "Google Sheets" },
  { id: "github", name: "GitHub" },
  ...CATALOG.map((entry) => ({ id: entry.id, name: entry.name })),
];

// The "any other app" tile takes whatever is left
// of the last row at each width, so the grid ends
// square. Spelled out because Tailwind only ships
// class names it can see written down.

const SPAN_2 = ["col-span-2", "col-span-1"];
const SPAN_3 = ["sm:col-span-3", "sm:col-span-2", "sm:col-span-1"];
const SPAN_4 = ["lg:col-span-4", "lg:col-span-3", "lg:col-span-2", "lg:col-span-1"];

const FILL_ROW = [
  SPAN_2[APPS.length % 2],
  SPAN_3[APPS.length % 3],
  SPAN_4[APPS.length % 4],
].join(" ");

const STEPS = [
  {
    n: "1",
    title: "Sign up",
    body: "With your email or Google. Free, with as many people as you like.",
  },
  {
    n: "2",
    title: "Name a project",
    body: "One per team, product or class project. Every new project gets Team free for its first 2 months.",
  },
  {
    n: "3",
    title: "Give a channel a job",
    body: "Pick a ready-made agent - Research, Meeting notes, Planner, Bug triage - or write its instructions yourself.",
  },
  {
    n: "4",
    title: "Invite the team and ask",
    body: "Everyone talks to the same agent and sees the same answers. Approve anything it wants to change.",
  },
];


// The example project: one team's week, built only
// from agents and features the app actually has.

const EXAMPLE_CHANNELS = [
  {
    name: "planning",
    agent: "Planner",
    asked: "\u201cBreak the launch into tasks for next week.\u201d",
    did: "Six tasks with owners and dates, riskiest first - then asked before creating them in Linear.",
  },
  {
    name: "research",
    agent: "Research",
    asked: "\u201cCompare four analytics tools for us.\u201d",
    did: "A side-by-side on price, privacy and setup, with links to every source it used.",
  },
  {
    name: "meetings",
    agent: "Meeting notes",
    asked: "Monday's call notes, pasted in.",
    did: "The decisions, five action items with owners, and the open questions for next time.",
  },
  {
    name: "bugs",
    agent: "Bug triage",
    asked: "\u201cWhat broke since Friday?\u201d",
    did: "New Sentry errors grouped by cause, with the two that need fixing before launch at the top.",
  },
];


const BEFORE = [
  "Five people, five ChatGPT tabs, five different answers.",
  "Decisions buried in chat, and asked again next week.",
  "A status meeting just to find out what everyone did.",
  "Someone copies AI output into Linear by hand.",
  "Every new teammate means another AI subscription.",
];

const AFTER = [
  "One agent per channel that the whole team talks to.",
  "It remembers what the team decided, so nobody has to dig.",
  "A Monday summary posts itself.",
  "The agent drafts the Linear tasks; a person approves them.",
  "Unlimited people on the free plan.",
];


// Kept honest on purpose: the "can't" list is as real
// as the "can" list, and matches /security.

const CAN = [
  "Answer with the context of your project and channel.",
  "Search the web and link to what it found.",
  "Read and write the project's files.",
  "Read Google Sheets and GitHub - and add rows or open issues once you approve.",
  "Work in Notion, Linear, Jira, Asana, Sentry and more on Team.",
  "Run tasks in the background and on a schedule.",
  "Spot conflicting instructions and ask the team which to follow.",
];

const CANT = [
  "Change or delete anything in your tools without a person approving it.",
  "See into projects you're not a member of.",
  "Use apps you haven't connected, or go beyond your account's access.",
  "Finish very long jobs in one go - each task works in up to eight steps.",
  "Be right every time - check facts, numbers and links before you rely on them.",
  "Make the decision for you - it lays out options, your team decides.",
];


export default function Welcome() {
  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      {/* "<" escaped, as Next.js advises for JSON-LD. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(STRUCTURED_DATA).replace(/</g, "\\u003c"),
        }}
      />

      {/* ------------------------------ */}
      {/* TOP BAR                        */}
      {/* ------------------------------ */}

      <header className="mx-auto flex max-w-[1080px] items-center gap-3 px-6 py-5">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo size={30} />

          <span className="text-[15px] font-semibold tracking-[-0.01em]">
            Teamski
          </span>
        </Link>

        <nav className="ml-auto flex items-center gap-1 text-[13px]">
          <a
            href="#plans"
            className="hidden rounded-md px-3 py-1.5 text-[var(--text-muted)] transition hover:text-[var(--text)] sm:block"
          >
            Plans
          </a>

          <Link
            href="/blog"
            className="hidden rounded-md px-3 py-1.5 text-[var(--text-muted)] transition hover:text-[var(--text)] sm:block"
          >
            Blog
          </Link>

          <Link
            href="/hackathons"
            className="hidden rounded-md px-3 py-1.5 text-[var(--text-muted)] transition hover:text-[var(--text)] sm:block"
          >
            Hackathons
          </Link>

          <Link
            href="/login"
            className="rounded-md px-3 py-1.5 text-[var(--text-muted)] transition hover:text-[var(--text)]"
          >
            Sign in
          </Link>

          <Link
            href="/login?mode=signup"
            className="rounded-md bg-[var(--text)] px-3 py-1.5 font-medium text-[var(--bg)] transition hover:opacity-90"
          >
            Get started
          </Link>
        </nav>
      </header>


      {/* ------------------------------ */}
      {/* HERO                           */}
      {/* ------------------------------ */}

      <section className="mx-auto grid max-w-[1080px] items-center gap-12 px-6 pt-12 pb-20 md:grid-cols-[1.05fr_1fr] md:pt-20">
        <div>
          <span className="mb-6 inline-flex items-center gap-2.5 rounded-full border border-[var(--border-strong)] bg-[var(--bg-raised)] px-4 py-2 text-[15px] font-semibold text-[var(--text)] shadow-sm">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--accent)]" />
            </span>
            Launch offer —{" "}
            <span className="text-[var(--accent)]">
              Team free for 2 months
            </span>
          </span>

          <h1 className="text-[40px] leading-[1.08] font-semibold tracking-[-0.03em] sm:text-[52px]">
            Your team and its AI agents, working in one place.
          </h1>

          <p className="mt-5 max-w-[480px] text-[16px] leading-[1.6] text-[var(--text-muted)]">
            Every channel gets its own agent. Talk to it together, hand it
            tasks that run in the background, and connect the tools your
            team already uses.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/login?mode=signup"
              className="rounded-lg bg-[var(--text)] px-5 py-2.5 text-[14px] font-medium text-[var(--bg)] transition hover:opacity-90"
            >
              Get started free
            </Link>

            <Link
              href="/login"
              className="rounded-lg border border-[var(--border-strong)] px-5 py-2.5 text-[14px] text-[var(--text)] transition hover:bg-[var(--bg-hover)]"
            >
              Sign in
            </Link>
          </div>

          <p className="mt-4 text-[12.5px] text-[var(--text-faint)]">
            Free plan with unlimited people — and every new project
            gets Team free for its first 2 months.
          </p>
        </div>

        <ChannelPreview />
      </section>


      {/* ------------------------------ */}
      {/* WHAT IT DOES                   */}
      {/* ------------------------------ */}

      <section className="border-t border-[var(--border)]">
        <div className="mx-auto max-w-[1080px] px-6 py-20">
          <h2 className="max-w-[560px] text-[28px] leading-tight font-semibold tracking-[-0.02em]">
            Agents that sit in the room with your team, not in a separate tab.
          </h2>

          <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="bg-[var(--bg)] p-6"
              >
                <h3 className="text-[15px] font-semibold">
                  {feature.title}
                </h3>

                <p className="mt-2 text-[13.5px] leading-[1.6] text-[var(--text-muted)]">
                  {feature.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* ------------------------------ */}
      {/* AN EXAMPLE PROJECT             */}
      {/* ------------------------------ */}
      {/*                                */}
      {/* Illustrative, and labelled so: */}
      {/* what one team's week looks     */}
      {/* like, built from the agents    */}
      {/* and features the app has.      */}

      <section
        id="example"
        className="scroll-mt-6 border-t border-[var(--border)] bg-[var(--bg-panel)]"
      >
        <div className="mx-auto max-w-[1080px] px-6 py-20">
          <span className="rounded bg-[var(--bg-raised)] px-2 py-1 text-[11px] tracking-[0.08em] text-[var(--text-faint)] uppercase">
            Example project
          </span>

          <h2 className="mt-4 max-w-[620px] text-[28px] leading-tight font-semibold tracking-[-0.02em]">
            A product team launching a new website, in one project.
          </h2>

          <p className="mt-2 max-w-[620px] text-[14px] text-[var(--text-muted)]">
            Four channels, four agents, each with its own job and its own
            memory of the work. Here&apos;s what one week looks like.
          </p>

          <div className="mt-10 overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--bg)] md:grid md:grid-cols-[220px_1fr]">
            <div className="border-b border-[var(--border)] px-4 py-4 md:border-r md:border-b-0">
              <p className="text-[13px] font-semibold">Website launch</p>

              <p className="mt-0.5 text-[11.5px] text-[var(--text-faint)]">
                5 people · Team
              </p>

              <ul className="mt-4 space-y-1">
                {EXAMPLE_CHANNELS.map((channel) => (
                  <li
                    key={channel.name}
                    className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[13px] text-[var(--text-muted)]"
                  >
                    <span># {channel.name}</span>

                    <span className="truncate text-[11px] text-[var(--text-faint)]">
                      {channel.agent}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid gap-px bg-[var(--border)] sm:grid-cols-2">
              {EXAMPLE_CHANNELS.map((channel) => (
                <div key={channel.name} className="bg-[var(--bg)] p-5">
                  <p className="text-[12px] text-[var(--text-faint)]">
                    # {channel.name} · {channel.agent}
                  </p>

                  <p className="mt-2 text-[13.5px] leading-[1.55] text-[var(--text)]">
                    {channel.asked}
                  </p>

                  <p className="mt-2 text-[13px] leading-[1.55] text-[var(--text-muted)]">
                    {channel.did}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3.5">
              <p className="text-[12px] text-[var(--text-faint)]">
                Scheduled · every Monday, 9:00
              </p>

              <p className="mt-1 text-[13.5px] text-[var(--text-muted)]">
                The planning agent posts what the team decided last week and
                what is still blocked - before anyone asks.
              </p>
            </div>

            <div className="rounded-xl border border-[var(--border-strong)] bg-[var(--bg-raised)] px-4 py-3.5">
              <p className="text-[12px] text-[var(--text-faint)]">
                Waiting for approval
              </p>

              <p className="mt-1 text-[13.5px] text-[var(--text-muted)]">
                Linear: create 6 issues from the launch plan. Nothing changes
                in Linear until someone presses Approve.
              </p>
            </div>
          </div>
        </div>
      </section>


      {/* ------------------------------ */}
      {/* BEFORE AND AFTER               */}
      {/* ------------------------------ */}

      <section className="border-t border-[var(--border)]">
        <div className="mx-auto max-w-[1080px] px-6 py-20">
          <h2 className="text-[28px] font-semibold tracking-[-0.02em]">
            Before and after Teamski
          </h2>

          <div className="mt-10 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-[var(--border)] p-6">
              <p className="text-[12px] tracking-[0.08em] text-[var(--text-faint)] uppercase">
                Before
              </p>

              <ul className="mt-4 space-y-3">
                {BEFORE.map((line) => (
                  <li
                    key={line}
                    className="flex gap-3 text-[13.5px] leading-[1.55] text-[var(--text-muted)]"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-[1px] shrink-0 text-[var(--text-faint)]"
                    >
                      ✕
                    </span>

                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-[var(--border-strong)] bg-[var(--bg-panel)] p-6">
              <p className="text-[12px] tracking-[0.08em] text-[var(--text)] uppercase">
                With Teamski
              </p>

              <ul className="mt-4 space-y-3">
                {AFTER.map((line) => (
                  <li
                    key={line}
                    className="flex gap-3 text-[13.5px] leading-[1.55] text-[var(--text)]"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-[1px] shrink-0 text-[var(--accent)]"
                    >
                      ✓
                    </span>

                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>


      {/* ------------------------------ */}
      {/* CONNECTS TO                    */}
      {/* ------------------------------ */}

      <section className="border-t border-[var(--border)]">
        <div className="mx-auto max-w-[1080px] px-6 py-20">
          <h2 className="text-[28px] font-semibold tracking-[-0.02em]">
            Works with the tools you already use
          </h2>

          <p className="mt-2 max-w-[560px] text-[14px] text-[var(--text-muted)]">
            Connect an app once and every agent in your project can read from
            it, and ask before changing anything.
          </p>

          <ConnectionsOrbit apps={APPS} />

          <ul className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {APPS.map((app) => (
              <li
                key={app.id}
                className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] px-4 py-3.5"
              >
                <BrandIcon
                  id={app.id}
                  className="h-5 w-5 shrink-0 text-[var(--text)]"
                />

                <span className="truncate text-[13.5px]">{app.name}</span>
              </li>
            ))}

            {/* Anything else that speaks MCP. */}

            <li
              className={`flex items-center gap-3 rounded-xl border border-dashed border-[var(--border-strong)] px-4 py-3.5 ${FILL_ROW}`}
            >
              <span
                aria-hidden="true"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--text-muted)] text-[13px] leading-none text-[var(--text-muted)]"
              >
                +
              </span>

              <span className="min-w-0">
                <span className="block text-[13.5px]">Any other app</span>

                <span className="block text-[12px] text-[var(--text-faint)]">
                  Add any MCP server by its address on Team
                </span>
              </span>
            </li>
          </ul>
        </div>
      </section>


      {/* ------------------------------ */}
      {/* WHAT IT CAN AND CAN'T DO       */}
      {/* ------------------------------ */}

      <section className="border-t border-[var(--border)]">
        <div className="mx-auto max-w-[1080px] px-6 py-20">
          <h2 className="text-[28px] font-semibold tracking-[-0.02em]">
            What the agent can and can&apos;t do
          </h2>

          <p className="mt-2 max-w-[560px] text-[14px] text-[var(--text-muted)]">
            So you know what to hand it, and what to keep for yourselves.
          </p>

          <div className="mt-10 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] p-6">
              <h3 className="text-[15px] font-semibold">It can</h3>

              <ul className="mt-4 space-y-2.5">
                {CAN.map((line) => (
                  <li
                    key={line}
                    className="flex gap-3 text-[13.5px] leading-[1.55] text-[var(--text-muted)]"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-[1px] shrink-0 text-[var(--accent)]"
                    >
                      ✓
                    </span>

                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-[var(--border)] p-6">
              <h3 className="text-[15px] font-semibold">It can&apos;t</h3>

              <ul className="mt-4 space-y-2.5">
                {CANT.map((line) => (
                  <li
                    key={line}
                    className="flex gap-3 text-[13.5px] leading-[1.55] text-[var(--text-muted)]"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-[1px] shrink-0 text-[var(--text-faint)]"
                    >
                      ✕
                    </span>

                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>


      {/* ------------------------------ */}
      {/* CREATE YOUR FIRST PROJECT      */}
      {/* ------------------------------ */}

      <section
        id="start"
        className="scroll-mt-6 border-t border-[var(--border)] bg-[var(--bg-panel)]"
      >
        <div className="mx-auto max-w-[1080px] px-6 py-20">
          <h2 className="text-[28px] font-semibold tracking-[-0.02em]">
            Create your first project
          </h2>

          <p className="mt-2 max-w-[560px] text-[14px] text-[var(--text-muted)]">
            No card and nothing to set up - the built-in AI answers from the
            first message.
          </p>

          <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step) => (
              <div key={step.n}>
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-strong)] text-[13px] font-semibold">
                  {step.n}
                </span>

                <h3 className="mt-4 text-[16px] font-semibold">
                  {step.title}
                </h3>

                <p className="mt-2 text-[13.5px] leading-[1.6] text-[var(--text-muted)]">
                  {step.body}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link
              href="/login?mode=signup"
              className="rounded-lg bg-[var(--text)] px-5 py-2.5 text-[14px] font-medium text-[var(--bg)] transition hover:opacity-90"
            >
              Create your first project
            </Link>

            <Link
              href="#example"
              className="text-[13.5px] text-[var(--text-muted)] underline underline-offset-2 transition hover:text-[var(--text)]"
            >
              See an example project
            </Link>
          </div>
        </div>
      </section>


      {/* ------------------------------ */}
      {/* PLANS                          */}
      {/* ------------------------------ */}
      {/*                                */}
      {/* From the same table the app    */}
      {/* enforces, so the page and the  */}
      {/* limits cannot disagree.        */}

      <section
        id="plans"
        className="scroll-mt-6 border-t border-[var(--border)]"
      >
        <div className="mx-auto max-w-[1080px] px-6 py-20">
          <h2 className="text-[28px] font-semibold tracking-[-0.02em]">
            Plans
          </h2>

          <p className="mt-2 text-[14px] text-[var(--text-muted)]">
            Free to start, with your whole team. Team upgrades the whole
            project — one plan, everyone included.{" "}
            <span className="text-[var(--text)]">
              Right now, every new project gets Team free for 2 months.
            </span>
          </p>

          <PlanCards />

          <p className="mt-4 text-[12px] leading-relaxed text-[var(--text-faint)]">
            Messages on your own or a shared API key are billed by that AI
            provider and do not count toward the daily allowance. Prices and
            limits may change.
          </p>
        </div>
      </section>


      {/* ------------------------------ */}
      {/* QUESTIONS TEAMS ASK            */}
      {/* ------------------------------ */}

      <section
        id="faq"
        className="scroll-mt-6 border-t border-[var(--border)]"
      >
        <div className="mx-auto max-w-[1080px] px-6 py-20">
          <h2 className="text-[28px] font-semibold tracking-[-0.02em]">
            Questions teams ask
          </h2>

          <p className="mt-2 text-[14px] text-[var(--text-muted)]">
            The short answers. The full detail - including what isn&apos;t
            in place yet - is on{" "}
            <Link
              href="/security"
              className="text-[var(--text)] underline underline-offset-2"
            >
              Security &amp; your data
            </Link>
            .
          </p>

          <div className="mt-8 divide-y divide-[var(--border)] border-y border-[var(--border)]">
            {FAQ.map((item) => (
              <details key={item.q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium text-[var(--text)] [&::-webkit-details-marker]:hidden">
                  {item.q}

                  <span
                    aria-hidden="true"
                    className="shrink-0 text-[18px] leading-none text-[var(--text-faint)] transition group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>

                <p className="mt-2.5 max-w-[760px] text-[14px] leading-[1.65] text-[var(--text-muted)]">
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>


      {/* ------------------------------ */}
      {/* LAST CALL                      */}
      {/* ------------------------------ */}

      <section className="border-t border-[var(--border)] bg-[var(--bg-panel)]">
        <div className="mx-auto flex max-w-[1080px] flex-col items-start gap-6 px-6 py-16 md:flex-row md:items-center">
          <div className="flex-1">
            <h2 className="text-[24px] font-semibold tracking-[-0.02em]">
              Bring your team.
            </h2>

            <p className="mt-1 text-[14px] text-[var(--text-muted)]">
              Create a project, invite everyone, and give your first channel
              a job.
            </p>
          </div>

          <Link
            href="/login?mode=signup"
            className="rounded-lg bg-[var(--text)] px-5 py-2.5 text-[14px] font-medium text-[var(--bg)] transition hover:opacity-90"
          >
            Get started free
          </Link>
        </div>
      </section>


      {/* ------------------------------ */}
      {/* FOOTER                         */}
      {/* ------------------------------ */}

      <footer className="border-t border-[var(--border)]">
        <div className="mx-auto flex max-w-[1080px] flex-wrap items-center gap-x-5 gap-y-3 px-6 py-8 text-[12.5px] text-[var(--text-faint)]">
          <span className="flex items-center gap-2">
            <Logo size={20} />
            © 2026 {LEGAL.operator}
          </span>

          <Link href="/privacy" className="hover:text-[var(--text-muted)]">
            Privacy Policy
          </Link>

          <Link href="/terms" className="hover:text-[var(--text-muted)]">
            Terms of Service
          </Link>

          <Link href="/security" className="hover:text-[var(--text-muted)]">
            Security &amp; data
          </Link>

          <ContactUs className="hover:text-[var(--text-muted)] sm:ml-auto" />
        </div>
      </footer>
    </main>
  );
}


// ==========================================
// A LOOK AT A CHANNEL
// ==========================================
//
// Drawn in HTML rather than a screenshot, so it
// stays sharp, matches the app's colours, and
// never shows somebody's real data. It is an
// illustration of how a channel looks, not a
// recording.
//

function ChannelPreview() {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--bg-panel)] shadow-2xl shadow-black/40"
    >
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
        <span className="text-[13px] font-medium"># planning</span>

        <span className="rounded bg-[var(--bg-raised)] px-1.5 py-0.5 text-[10.5px] text-[var(--text-faint)]">
          Planning agent
        </span>

        <span className="ml-auto flex -space-x-1.5">
          {["R", "A", "S"].map((initial) => (
            <span
              key={initial}
              className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--bg-panel)] bg-[var(--bg-raised)] text-[9px] text-[var(--text-muted)]"
            >
              {initial}
            </span>
          ))}
        </span>
      </div>

      <div className="space-y-4 px-4 py-5 text-[13px] leading-[1.55]">
        <div>
          <p className="text-[11.5px] text-[var(--text-faint)]">Riya</p>

          <p className="mt-0.5 text-[var(--text)]">
            Break the website launch into tasks for next week and put them
            in Linear.
          </p>
        </div>

        <div>
          <p className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-faint)]">
            <Logo size={14} />
            Planning agent
          </p>

          <div className="mt-1.5 space-y-1 rounded-lg border border-[var(--border)] px-3 py-2 text-[11.5px] text-[var(--text-faint)]">
            <p>✓ Read plan.md</p>
            <p>✓ Linear: list projects</p>
          </div>

          <p className="mt-2 text-[var(--text-muted)]">
            Six tasks, riskiest first:
          </p>

          <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[var(--text-muted)]">
            <li>Final copy review · Aman · Mon</li>
            <li>Payment page QA · Sam · Tue</li>
            <li>DNS and HTTPS · Riya · Tue</li>
          </ol>

          <p className="mt-0.5 pl-5 text-[11.5px] text-[var(--text-faint)]">
            + 3 more
          </p>
        </div>

        <div className="rounded-lg border border-[var(--border-strong)] bg-[var(--bg-raised)] px-3 py-2.5">
          <p className="text-[12px] text-[var(--text)]">
            Linear: create 6 issues
          </p>

          <p className="mt-0.5 text-[11.5px] text-[var(--text-faint)]">
            This changes things in Linear, so it needs your approval.
          </p>

          <div className="mt-2 flex gap-2">
            <span className="rounded-md bg-[var(--text)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--bg)]">
              Approve
            </span>

            <span className="rounded-md px-2.5 py-1 text-[11.5px] text-[var(--text-muted)]">
              Not now
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}


// ==========================================
// QUESTIONS TEAMS ASK
// ==========================================
//
// Short, true answers. Anything with a caveat keeps it -
// the long versions live on /security, and both are
// written from what the app actually does.

const FAQ: { q: string; a: string }[] = [
  {
    q: "Do you train AI models on our data?",
    a: "No. Teamski never trains or fine-tunes a model on your messages, files or agent memory. To answer, the relevant conversation goes to the model that responds, under that provider's terms - OpenAI, Anthropic and Google's paid API don't train on API requests by default. Google's free Gemini tier may, so use a paid key for sensitive work.",
  },
  {
    q: "Is our data encrypted?",
    a: "Yes, in transit (HTTPS) and at rest. API keys, connected-account tokens and your agents' memory are encrypted a second time with a key only our server holds, and row-level security keeps each project visible only to its members. We don't have SOC 2 or ISO 27001 yet.",
  },
  {
    q: "Who can do what in a project?",
    a: "Owners control everything, including billing. Admins manage members, settings, connections and schedules. Members use the project. Agents need a person's approval before deleting files, writing to Google Sheets, opening GitHub issues or changing anything in a connected app. Per-channel permissions and a full audit log aren't available yet.",
  },
  {
    q: "What does it connect to?",
    a: "On every plan: web search, project files, Google Sheets, GitHub and image generation. On Team: Notion, Linear, Jira & Confluence, Asana, Sentry, Stripe, Canva, Hugging Face and any other MCP server - plus your own keys for Claude, OpenAI, Gemini, Grok and more.",
  },
  {
    q: "Can agents handle long tasks?",
    a: "Background tasks run on our server, keep going when you close the tab, pick up where they left off after a restart, and can be paused or stopped at any time. Each task works in up to eight steps, so split big jobs into smaller tasks or put them on a schedule.",
  },
  {
    q: "Can we export our data if we leave?",
    a: "Yes. A project's owner or admins can download the whole project - members, channels, every message, agent memory, schedules and files - as one file from Settings. You can delete your account at any time.",
  },
  {
    q: "How good is the free AI, really?",
    a: `The free plan runs GPT-OSS 120B, OpenAI's open-weight model, served by Groq - ${DAILY_MESSAGES.free} messages per person per day. When shared capacity is busy it steps down to smaller models and tells you. Team raises that to ${DAILY_MESSAGES.team} a day and lets you use your own Claude, GPT or Gemini key.`,
  },
];
