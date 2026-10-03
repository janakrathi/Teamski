import type { Metadata } from "next";

import Link from "next/link";

import Logo from "@/components/ui/Logo";

import BrandIcon from "@/components/ui/BrandIcon";

import { CATALOG } from "@/lib/mcp/catalog";

import PlanCards from "@/components/plans/PlanCards";

import ConnectionsOrbit from "@/components/landing/ConnectionsOrbit";

import {
  CONTAINER,
  H2,
  PRIMARY,
  SECONDARY,
  SITE_THEME,
  SiteFooter,
  SiteHeader,
  at,
} from "@/components/landing/Site";

import Reveal from "@/components/landing/Reveal";

import Backdrop from "@/components/landing/Backdrop";

import Faq from "@/components/landing/Faq";

import {
  ApprovalLog,
  ChannelTree,
  ModelRouter,
  TaskLoop,
} from "@/components/landing/Diagrams";

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

// The features that have a picture of their own. The
// rest sit in a quieter row underneath.
const VISUALS: Record<string, React.ReactNode> = {
  "A channel, an agent": <ChannelTree />,
  "Work that keeps going": <TaskLoop />,
  "Changes wait for you": <ApprovalLog />,
  "Pick the model": <ModelRouter />,
};


export default function Welcome() {
  return (
    <main
      style={SITE_THEME}
      className="relative isolate min-h-screen shrink-0 overflow-x-clip text-[#ededed]"
    >
      {/* Black, a muted drifting colour and the signal
          lines, behind the whole page. */}
      <Backdrop />

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

      <SiteHeader overlay />


      {/* ------------------------------ */}
      {/* HERO                           */}
      {/* ------------------------------ */}

      <section className="relative isolate flex min-h-[max(640px,100svh)] flex-col justify-center overflow-hidden">

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_55%_at_18%_55%,rgba(0,0,0,0.35),transparent_70%)]"
        />

        <div className={`${CONTAINER} relative pt-28 pb-20`}>
          <span
            style={at(0)}
            className="t-text-reveal inline-flex items-center gap-2.5 rounded-full border border-white/12 bg-black/70 px-3.5 py-1.5 text-[13px] text-white/80"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--accent)]" />
            </span>
            Launch offer —{" "}
            <span className="text-[#e08a6a]">Team free for 2 months</span>
          </span>

          <h1
            style={at(1)}
            className="t-text-reveal mt-8 max-w-[780px] text-[42px] leading-[1.05] font-[450] tracking-[-0.035em] sm:text-[64px]"
          >
            Your team and its AI agents,{" "}
            <span className="text-white/60">working in one place.</span>
          </h1>

          <p
            style={at(2)}
            className="t-text-reveal mt-6 max-w-[480px] text-[16px] leading-[1.6] text-white/60"
          >
            Every channel gets its own agent. Talk to it together, hand it
            tasks that run in the background, and connect the tools your
            team already uses.
          </p>

          <div style={at(3)} className="t-text-reveal mt-9 flex flex-wrap items-center gap-3">
            <Link href="/login?mode=signup" className={PRIMARY}>
              Get started free
            </Link>

            <Link href="#features" className={SECONDARY}>
              See how it works
            </Link>
          </div>

          <p style={at(4)} className="t-text-reveal mt-5 text-[12.5px] text-white/40">
            Free plan with unlimited people — and every new project
            gets Team free for its first 2 months.
          </p>
        </div>
      </section>


      {/* ------------------------------ */}
      {/* WHAT IT IS, AND A LOOK         */}
      {/* ------------------------------ */}

      <section className="overflow-hidden lp-section">
        <span aria-hidden="true" className="lp-ambient" style={{ top: "30%" }} />

        <Reveal className={`${CONTAINER} grid gap-5 py-20 sm:py-28`}>
          <h2 className={`t-reveal-item ${H2}`}>
            Agents that sit in the room with your team,{" "}
            <span className="text-white/60">not in a separate tab.</span>
          </h2>

          <div style={at(1)} className="t-reveal-item max-w-[640px]">
            <p className="text-[15px] leading-[1.65] text-white/60">
              One agent per channel, with its own instructions and memory of
              the work. Everyone talks to the same agent and sees the same
              answers - and it asks before it changes anything.
            </p>

            <Link
              href="#plans"
              className="group mt-4 inline-flex items-center gap-1.5 text-[13.5px] text-[#ededed]"
            >
              <span className="border-b border-white/30 pb-0.5 transition-colors duration-150 group-hover:border-white">
                See the plans
              </span>

              <span
                aria-hidden="true"
                className="transition-transform duration-[250ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-0.5"
              >
                →
              </span>
            </Link>
          </div>
        </Reveal>

        <Reveal className={`${CONTAINER} pb-20 sm:pb-28`}>
          <div data-signal-clear className="t-reveal-card relative mx-auto max-w-[760px]">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -inset-x-16 -inset-y-10 bg-[radial-gradient(ellipse_at_center,rgba(201,100,66,0.12),transparent_65%)]"
            />

            <div className="relative">
              <ChannelPreview />
            </div>
          </div>
        </Reveal>
      </section>


      {/* ------------------------------ */}
      {/* WHAT IT DOES                   */}
      {/* ------------------------------ */}

      <section id="features" className="scroll-mt-6 lp-section">
        <span aria-hidden="true" className="lp-ambient" style={{ top: "18%" }} />

        <div className={`${CONTAINER} py-20 sm:py-28`}>
          <Reveal>
            <h2 className={`t-reveal-item max-w-[720px] ${H2}`}>
              Built around how teams work,{" "}
              <span className="text-white/60">not around one person and a chatbot.</span>
            </h2>
          </Reveal>

          {/* The four ideas in a window of their own that
              scrolls - one at a time, snapping into place. */}
          <Reveal clear className="mt-14">
            <div className="t-reveal-card lp-glow overflow-hidden rounded-2xl border border-white/10 bg-[#050505] shadow-[0_30px_80px_rgba(0,0,0,0.5)]">
              <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />

                <span className="ml-3 text-[12px] text-white/45">
                  Teamski · how it works
                </span>

                <span className="ml-auto flex items-center gap-1.5 text-[11px] text-white/35">
                  Scroll
                  <span aria-hidden="true">↓</span>
                </span>
              </div>

              <div
                tabIndex={0}
                aria-label="How Teamski works, in four parts"
                className="h-[540px] snap-y snap-mandatory overflow-y-auto md:h-[440px]"
              >
                {FEATURES.filter((feature) => VISUALS[feature.title]).map(
                  (feature, index, shown) => (
                    <Reveal
                      key={feature.title}
                      className="flex min-h-full snap-start flex-col items-center justify-center gap-8 border-b border-white/5 px-6 py-10 last:border-b-0 md:flex-row md:gap-14 md:px-14"
                    >
                      <div className="t-reveal-card flex h-[190px] w-full max-w-[380px] shrink-0 items-center justify-center">
                        {VISUALS[feature.title]}
                      </div>

                      <div style={at(1)} className="t-reveal-item w-full max-w-[440px]">
                        <p className="text-[11px] tracking-[0.12em] text-white/35 uppercase tabular-nums">
                          0{index + 1} / 0{shown.length}
                        </p>

                        <h3 className="mt-3 text-[22px] font-[450] tracking-[-0.015em]">
                          {feature.title}
                        </h3>

                        <p className="mt-2 text-[14.5px] leading-[1.65] text-white/55">
                          {feature.body}
                        </p>
                      </div>
                    </Reveal>
                  )
                )}
              </div>
            </div>
          </Reveal>

          <div className="mt-6 grid border-t border-white/10 md:grid-cols-2">
            {FEATURES.filter((feature) => !VISUALS[feature.title]).map(
              (feature, index) => (
                <Reveal
                  key={feature.title}
                  className={`border-b border-white/10 py-8 ${
                    index % 2 === 0 ? "md:border-r md:pr-10" : "md:pl-10"
                  }`}
                >
                  <h3 className="t-reveal-item text-[16px] font-[450]">
                    {feature.title}
                  </h3>

                  <p style={at(1)} className="t-reveal-item mt-2 max-w-[460px] text-[14px] leading-[1.65] text-white/55">
                    {feature.body}
                  </p>
                </Reveal>
              )
            )}
          </div>
        </div>
      </section>


      {/* ------------------------------ */}
      {/* CONNECTS TO                    */}
      {/* ------------------------------ */}

      <section className="lp-section">
        <span aria-hidden="true" className="lp-ambient" style={{ top: "35%" }} />

        <div className={`${CONTAINER} py-20 sm:py-28`}>
          <Reveal className="grid gap-5">
            <h2 className={`t-reveal-item ${H2}`}>
              Works with the tools{" "}
              <span className="text-white/60">you already use.</span>
            </h2>

            <p style={at(1)} className="t-reveal-item max-w-[640px] text-[15px] leading-[1.65] text-white/60">
              Connect an app once and every agent in your project can read
              from it, and ask before changing anything.
            </p>
          </Reveal>

          <Reveal clear>
            <div className="t-reveal-card">
              <ConnectionsOrbit apps={APPS} />
            </div>
          </Reveal>

          <Reveal clear>
          <ul className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {APPS.map((app, index) => (
              <li
                key={app.id}
                style={at(Math.min(index, 10))}
                className="t-reveal-card lp-card flex items-center gap-3 rounded-xl border border-white/10 bg-[#050505] px-4 py-3.5"
              >
                <BrandIcon
                  id={app.id}
                  colored
                  className="h-5 w-5 shrink-0 text-[#ededed]"
                />

                <span className="truncate text-[13.5px]">{app.name}</span>
              </li>
            ))}

            {/* Anything else that speaks MCP. */}

            <li
              style={at(Math.min(APPS.length, 11))}
              className={`t-reveal-card flex items-center gap-3 rounded-xl border border-dashed border-white/15 px-4 py-3.5 ${FILL_ROW}`}
            >
              <span
                aria-hidden="true"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/40 text-[13px] leading-none text-white/60"
              >
                +
              </span>

              <span className="min-w-0">
                <span className="block text-[13.5px]">Any other app</span>

                <span className="block text-[12px] text-white/40">
                  Add any MCP server by its address on Team
                </span>
              </span>
            </li>
          </ul>
          </Reveal>
        </div>
      </section>


      {/* ------------------------------ */}
      {/* PLANS                          */}
      {/* ------------------------------ */}
      {/*                                */}
      {/* From the same table the app    */}
      {/* enforces, so the page and the  */}
      {/* limits cannot disagree.        */}

      <section id="plans" className="scroll-mt-6 lp-section">
        <span aria-hidden="true" className="lp-ambient" style={{ top: "40%" }} />

        {/* The heading sits on a faint band of the signal
            field, fading out before the plan cards. */}
        <div className="relative isolate overflow-hidden">

          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_45%_70%_at_22%_60%,rgba(0,0,0,0.75),transparent_70%),radial-gradient(ellipse_40%_70%_at_75%_55%,rgba(0,0,0,0.7),transparent_70%)]"
          />

          <Reveal className={`${CONTAINER} relative grid gap-5 pt-24 pb-16 sm:pt-32 sm:pb-20`}>
            <h2 className={`t-reveal-item ${H2}`}>
              Plans{" "}
              <span className="text-white/60">for the whole team.</span>
            </h2>

            <p style={at(1)} className="t-reveal-item max-w-[640px] text-[15px] leading-[1.65] text-white/60">
              Free to start, with your whole team. Team upgrades the whole
              project — one plan, everyone included.{" "}
              <span className="text-[#ededed]">
                Right now, every new project gets Team free for 2 months.
              </span>
            </p>
          </Reveal>
        </div>

        <div className={`${CONTAINER} pb-20 sm:pb-28`}>
          <Reveal clear>
            <PlanCards />
          </Reveal>

          <p className="mt-4 text-[12px] leading-relaxed text-white/40">
            Messages on your own or a shared API key are billed by that AI
            provider and do not count toward the daily allowance. Prices and
            limits may change.
          </p>
        </div>
      </section>


      {/* ------------------------------ */}
      {/* QUESTIONS TEAMS ASK            */}
      {/* ------------------------------ */}

      <section id="faq" className="scroll-mt-6 lp-section">
        <span aria-hidden="true" className="lp-ambient" style={{ top: "5%" }} />

        <div className={`${CONTAINER} grid gap-10 py-20 sm:py-28 md:grid-cols-[1fr_1.6fr]`}>
          <Reveal>
            <h2 className={`t-reveal-item ${H2}`}>
              Questions{" "}
              <span className="text-white/60">teams ask.</span>
            </h2>

            <p style={at(1)} className="t-reveal-item mt-4 max-w-[360px] text-[14.5px] leading-[1.65] text-white/55">
              The short answers. The full detail - including what isn&apos;t
              in place yet - is on{" "}
              <Link
                href="/security"
                className="text-[#ededed] underline decoration-white/30 underline-offset-4 transition-colors duration-150 hover:decoration-white"
              >
                Security &amp; your data
              </Link>
              .
            </p>
          </Reveal>

          <Reveal>
            <Faq items={FAQ} />
          </Reveal>
        </div>
      </section>


      {/* ------------------------------ */}
      {/* LAST CALL                      */}
      {/* ------------------------------ */}

      <section className="relative isolate overflow-hidden lp-section">
        <span aria-hidden="true" className="lp-ambient" style={{ top: "15%" }} />


        <Reveal className={`${CONTAINER} relative flex min-h-[460px] flex-col items-center justify-center py-24 text-center`}>
          <h2 className="t-reveal-item text-[40px] leading-[1.05] font-[450] tracking-[-0.035em] sm:text-[56px]">
            Bring your team.
          </h2>

          <p style={at(1)} className="t-reveal-item mt-4 max-w-[420px] text-[15px] leading-[1.6] text-white/60">
            Create a project, invite everyone, and give your first channel
            a job.
          </p>

          <div style={at(2)} className="t-reveal-item mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/login?mode=signup" className={PRIMARY}>
              Get started free
            </Link>

            <Link href="/login" className={SECONDARY}>
              Sign in
            </Link>
          </div>
        </Reveal>
      </section>


      {/* ------------------------------ */}
      {/* FOOTER                         */}
      {/* ------------------------------ */}

      <SiteFooter />
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
        <div className="t-seq" style={at(0)}>
          <p className="text-[11.5px] text-[var(--text-faint)]">Riya</p>

          <p className="mt-0.5 text-[var(--text)]">
            Break the website launch into tasks for next week and put them
            in Linear.
          </p>
        </div>

        <div>
          <p className="t-seq flex items-center gap-1.5 text-[11.5px] text-[var(--text-faint)]" style={at(1)}>
            <Logo size={14} />
            Planning agent
          </p>

          <div className="mt-1.5 space-y-1 rounded-lg border border-[var(--border)] px-3 py-2 text-[11.5px] text-[var(--text-faint)]">
            <p className="t-seq" style={at(2)}>✓ Read plan.md</p>
            <p className="t-seq" style={at(3)}>✓ Linear: list projects</p>
          </div>

          <p className="t-seq mt-2 text-[var(--text-muted)]" style={at(4)}>
            Six tasks, riskiest first:
          </p>

          <ol className="t-seq mt-1 list-decimal space-y-0.5 pl-5 text-[var(--text-muted)]" style={at(5)}>
            <li>Final copy review · Aman · Mon</li>
            <li>Payment page QA · Sam · Tue</li>
            <li>DNS and HTTPS · Riya · Tue</li>
          </ol>

          <p className="mt-0.5 pl-5 text-[11.5px] text-[var(--text-faint)]">
            + 3 more
          </p>
        </div>

        <div className="t-seq rounded-lg border border-[var(--border-strong)] bg-[var(--bg-raised)] px-3 py-2.5" style={at(6)}>
          <p className="text-[12px] text-[var(--text)]">
            Linear: create 6 issues
          </p>

          <p className="mt-0.5 text-[11.5px] text-[var(--text-faint)]">
            This changes things in Linear, so it needs your approval.
          </p>

          <div className="mt-2 flex gap-2">
            <span className="lp-pulse rounded-md bg-[var(--text)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--bg)]">
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
