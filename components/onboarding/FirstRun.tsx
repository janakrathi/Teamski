"use client";

import { useEffect, useState } from "react";

import Logo from "@/components/ui/Logo";

import { TemplateCard } from "@/components/chat/NewChannelDialog";

import { TEMPLATES } from "@/lib/agents/templates";


// ==========================================
// FIRST RUN
// ==========================================
//
// Somebody who has just signed up has no project,
// and the app behind them is an empty sidebar and
// "Create a project to begin". A person who has
// never used a tool like this does not know what a
// channel is for, or that the agent needs a job.
//
// So three short steps, each one doing real work
// as soon as it is confirmed:
//
//   1. Name the project (and yourself, since that
//      is the name in every invite you send).
//   2. Give the first channel a job.
//   3. Invite the team.
//
// Somebody who was invited never sees this: their
// invite is claimed on sign-in and they land in a
// project that already exists.
//
// Skipping is always allowed. Whatever was made
// before skipping is kept.
//

type Project = { id: string; name: string; created_at?: string };

type Channel = { id: string; name: string; project_id?: string; created_at?: string };

type Step = "project" | "channel" | "team";

const STEPS: Step[] = ["project", "channel", "team"];


export default function FirstRun({
  onFinished,
}: {
  onFinished: (result: {
    project: Project | null;
    channel: Channel | null;
    templateId: string | null;
  }) => void;
}) {
  const [step, setStep] = useState<Step>("project");

  const [displayName, setDisplayName] = useState("");
  const [hadName, setHadName] = useState(true);

  const [projectName, setProjectName] = useState("");
  const [project, setProject] = useState<Project | null>(null);

  const [templateId, setTemplateId] = useState<string | null>(
    "planner"
  );
  const [channelName, setChannelName] = useState("planning");
  const [channelNameTouched, setChannelNameTouched] =
    useState(false);
  const [channel, setChannel] = useState<Channel | null>(null);

  const [emails, setEmails] = useState("");

  const [results, setResults] = useState<
    { email: string; ok: boolean; message: string }[]
  >([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");


  // Whether to ask for a name at all. People who
  // signed in with Google already have one.

  useEffect(() => {
    let cancelled = false;

    fetch("/api/profile", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) {
          return;
        }

        const existing = data.profile?.display_name ?? "";

        setHadName(Boolean(existing));
        setDisplayName(existing);
      })
      .catch(() => {
        // Asking for a name nobody needed is harmless.
        if (!cancelled) {
          setHadName(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);


  function finish(
    override?: Partial<{
      project: Project | null;
      channel: Channel | null;
    }>
  ) {
    const madeChannel = override?.channel ?? channel;

    onFinished({
      project: override?.project ?? project,
      channel: madeChannel,
      templateId: madeChannel ? templateId : null,
    });
  }


  // ------------------------------------------
  // 1. THE PROJECT
  // ------------------------------------------

  async function createProject() {
    const name = projectName.trim();

    if (!name || busy) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      // The name first, so the first invite already
      // says who it is from.

      if (!hadName && displayName.trim()) {
        await fetch("/api/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            display_name: displayName.trim(),
          }),
        }).catch(() => {});
      }

      const made = project
        ? project
        : await post<{ project: Project }>(
            "/api/projects",
            { name }
          ).then((data) => data.project);

      setProject(made);
      setStep("channel");
    } catch (cause) {
      setError(message(cause, "Could not create the project."));
    } finally {
      setBusy(false);
    }
  }


  // ------------------------------------------
  // 2. THE FIRST CHANNEL
  // ------------------------------------------

  function choose(id: string | null) {
    setTemplateId(id);

    if (!channelNameTouched) {
      setChannelName(
        TEMPLATES.find((template) => template.id === id)
          ?.channel ?? "general"
      );
    }
  }

  async function createChannel() {
    if (!project || !channelName.trim() || busy) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const made = channel
        ? channel
        : await post<{ channel: Channel }>(
            `/api/projects/${project.id}/channels`,
            { name: channelName.trim(), templateId }
          ).then((data) => data.channel);

      setChannel(made);
      setStep("team");
    } catch (cause) {
      setError(message(cause, "Could not create the channel."));
    } finally {
      setBusy(false);
    }
  }


  // ------------------------------------------
  // 3. THE TEAM
  // ------------------------------------------

  const parsed = [
    ...new Set(
      emails
        .split(/[\s,;]+/)
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];

  const invalid = parsed.filter(
    (entry) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(entry)
  );

  async function invite() {
    if (!project || busy) {
      return;
    }

    if (parsed.length === 0) {
      finish();
      return;
    }

    if (invalid.length > 0) {
      setError(
        `${invalid.join(", ")} ${
          invalid.length === 1 ? "is not an email address" : "are not email addresses"
        }.`
      );
      return;
    }

    setBusy(true);
    setError("");

    const outcomes: typeof results = [];

    // One at a time, so the daily invite limit and
    // any duplicate are reported against the right
    // address.

    for (const email of parsed.slice(0, 20)) {
      try {
        const response = await fetch(
          `/api/projects/${project.id}/members`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          }
        );

        const data = await response.json();

        outcomes.push({
          email,
          ok: response.ok,
          message: response.ok
            ? data.emailed
              ? "Invite emailed"
              : data.added
                ? "Added"
                : "Invited, send them the link"
            : (data.error ?? "Could not invite"),
        });
      } catch {
        outcomes.push({
          email,
          ok: false,
          message: "Could not invite",
        });
      }
    }

    setResults(outcomes);
    setBusy(false);
  }


  const index = STEPS.indexOf(step);

  const picked = TEMPLATES.find(
    (template) => template.id === templateId
  );


  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[var(--bg)]">
      <div className="mx-auto flex min-h-full max-w-[600px] flex-col px-6 py-10">

        {/* ---------------------------- */}
        {/* HEADER                       */}
        {/* ---------------------------- */}

        <div className="flex items-center gap-2.5">
          <Logo size={28} />

          <span className="text-[14px] font-semibold">Teamski</span>

          <span className="ml-auto text-[12px] text-[var(--text-faint)]">
            Step {index + 1} of {STEPS.length}
          </span>
        </div>

        <div className="mt-4 flex gap-1.5" aria-hidden="true">
          {STEPS.map((item, n) => (
            <span
              key={item}
              className={`h-1 flex-1 rounded-full ${
                n <= index
                  ? "bg-[var(--text)]"
                  : "bg-[var(--border-strong)]"
              }`}
            />
          ))}
        </div>


        <div className="mt-10 flex-1">

          {/* -------------------------- */}
          {/* 1                          */}
          {/* -------------------------- */}

          {step === "project" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void createProject();
              }}
            >
              <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em]">
                Welcome to Teamski
              </h1>

              <p className="mt-2 text-[14px] leading-relaxed text-[var(--text-muted)]">
                A project is where your team and its AI agents work
                together. Start with the thing you are working on right
                now.
              </p>

              {!hadName && (
                <Field
                  label="Your name"
                  hint="Shown to your team and in the invites you send."
                >
                  <input
                    type="text"
                    value={displayName}
                    maxLength={60}
                    placeholder="Riya Sharma"
                    onChange={(event) =>
                      setDisplayName(event.target.value)
                    }
                    className={INPUT}
                  />
                </Field>
              )}

              <Field label="Project name">
                <input
                  type="text"
                  autoFocus
                  value={projectName}
                  maxLength={60}
                  disabled={Boolean(project)}
                  placeholder="Website launch"
                  onChange={(event) =>
                    setProjectName(event.target.value)
                  }
                  className={INPUT}
                />
              </Field>

              <Actions
                error={error}
                primary={busy ? "Creating…" : "Continue"}
                disabled={busy || !projectName.trim()}
                onSkip={() => finish()}
              />
            </form>
          )}


          {/* -------------------------- */}
          {/* 2                          */}
          {/* -------------------------- */}

          {step === "channel" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void createChannel();
              }}
            >
              <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em]">
                Give your first channel a job
              </h1>

              <p className="mt-2 text-[14px] leading-relaxed text-[var(--text-muted)]">
                Every channel has its own AI agent. Pick what this one
                is for and its agent starts with instructions for that
                job. You can add more channels later.
              </p>

              <div className="mt-6 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {TEMPLATES.map((template) => (
                  <TemplateCard
                    key={template.id}
                    emoji={template.emoji}
                    title={template.name}
                    tagline={template.tagline}
                    selected={templateId === template.id}
                    onClick={() => choose(template.id)}
                  />
                ))}

                <TemplateCard
                  emoji="＃"
                  title="Something else"
                  tagline="A general agent. Tell it what to do in Settings."
                  selected={templateId === null}
                  onClick={() => choose(null)}
                />
              </div>

              {picked?.worksBestWith && (
                <p className="mt-2 text-[12px] text-[var(--text-faint)]">
                  Works best with: {picked.worksBestWith}
                </p>
              )}

              <Field label="Channel name">
                <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] focus-within:border-[var(--border-strong)]">
                  <span className="pl-3 text-[13.5px] text-[var(--text-faint)]">
                    #
                  </span>

                  <input
                    type="text"
                    value={channelName}
                    maxLength={40}
                    disabled={Boolean(channel)}
                    onChange={(event) => {
                      setChannelName(event.target.value);
                      setChannelNameTouched(true);
                    }}
                    className="w-full bg-transparent px-2 py-2.5 text-[13.5px] text-[var(--text)] outline-none"
                  />
                </div>
              </Field>

              <Actions
                error={error}
                primary={busy ? "Creating…" : "Continue"}
                disabled={busy || !channelName.trim()}
                onSkip={() => finish()}
              />
            </form>
          )}


          {/* -------------------------- */}
          {/* 3                          */}
          {/* -------------------------- */}

          {step === "team" && results.length === 0 && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void invite();
              }}
            >
              <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em]">
                Invite your team
              </h1>

              <p className="mt-2 text-[14px] leading-relaxed text-[var(--text-muted)]">
                Everyone in {project?.name ?? "the project"} can talk to
                its agents together. Joining is free, and they get
                whatever plan this project is on.
              </p>

              <Field
                label="Email addresses"
                hint="Separate them with commas or new lines. You can invite more later from Settings → People."
              >
                <textarea
                  rows={4}
                  value={emails}
                  placeholder={"aman@company.com, sam@company.com"}
                  onChange={(event) => setEmails(event.target.value)}
                  className={`${INPUT} resize-none leading-relaxed`}
                />
              </Field>

              <Actions
                error={error}
                primary={
                  busy
                    ? "Inviting…"
                    : parsed.length === 0
                      ? "Start working"
                      : `Invite ${parsed.length} and start`
                }
                disabled={busy}
                skipLabel="Skip for now"
                onSkip={() => finish()}
              />
            </form>
          )}

          {step === "team" && results.length > 0 && (
            <div>
              <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em]">
                You are all set
              </h1>

              <ul className="mt-6 space-y-1.5">
                {results.map((result) => (
                  <li
                    key={result.email}
                    className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2 text-[13px]"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {result.email}
                    </span>

                    <span
                      className={`shrink-0 text-[12px] ${
                        result.ok ? "text-emerald-400" : "text-amber-300"
                      }`}
                    >
                      {result.message}
                    </span>
                  </li>
                ))}
              </ul>

              {results.some(
                (result) => result.message === "Invited, send them the link"
              ) && (
                <p className="mt-3 text-[12.5px] leading-relaxed text-[var(--text-faint)]">
                  Invite emails are not switched on yet. Send them a link
                  to teamski.in and ask them to sign up with the address
                  above - they join the project automatically.
                </p>
              )}

              <button
                type="button"
                onClick={() => finish()}
                className="mt-8 rounded-lg bg-[var(--text)] px-5 py-2.5 text-[14px] font-medium text-[var(--bg)] transition hover:opacity-90"
              >
                Open #{channel?.name ?? "your project"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ==========================================
// PIECES
// ==========================================

const INPUT =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2.5 text-[13.5px] text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--border-strong)] disabled:opacity-60";


function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mt-6 block">
      <span className="mb-1.5 block text-[11px] tracking-[0.06em] text-[var(--text-faint)] uppercase">
        {label}
      </span>

      {children}

      {hint && (
        <span className="mt-1.5 block text-[12px] leading-relaxed text-[var(--text-faint)]">
          {hint}
        </span>
      )}
    </label>
  );
}


function Actions({
  error,
  primary,
  disabled,
  onSkip,
  skipLabel = "Skip setup",
}: {
  error: string;
  primary: string;
  disabled: boolean;
  onSkip: () => void;
  skipLabel?: string;
}) {
  return (
    <>
      {error && (
        <p className="mt-4 text-[13px] leading-relaxed text-red-300">
          {error}
        </p>
      )}

      <div className="mt-8 flex items-center gap-3">
        <button
          type="submit"
          disabled={disabled}
          className="rounded-lg bg-[var(--text)] px-5 py-2.5 text-[14px] font-medium text-[var(--bg)] transition hover:opacity-90 disabled:opacity-40"
        >
          {primary}
        </button>

        <button
          type="button"
          onClick={onSkip}
          className="rounded-lg px-3 py-2.5 text-[13px] text-[var(--text-faint)] transition hover:text-[var(--text-muted)]"
        >
          {skipLabel}
        </button>
      </div>
    </>
  );
}


async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "That did not work.");
  }

  return data as T;
}


function message(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}
