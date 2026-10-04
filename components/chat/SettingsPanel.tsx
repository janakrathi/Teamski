"use client";

import { useEffect, useState } from "react";

import { primeJson } from "@/lib/net/cache";

import { Close } from "@/components/ui/Icons";

import AccountSection from "@/components/settings/AccountSection";

import ConnectionsSection from "@/components/settings/ConnectionsSection";

import ModelKeys from "@/components/settings/ModelKeys";

import ModelPicker from "@/components/settings/ModelPicker";

import ProjectKeys from "@/components/settings/ProjectKeys";

import PeopleSection from "@/components/settings/PeopleSection";

import SkillsSection from "@/components/settings/SkillsSection";

import PlanSection from "@/components/settings/PlanSection";

import McpSection from "@/components/settings/McpSection";

import { SELF_HOSTED } from "@/lib/plans";

import type { ChatSettings } from "./useChat";

import { usePresence } from "@/lib/ui/usePresence";


// The panel used to be one long scroll of model
// options called "Agent settings". Account and
// people are not agent settings, so they get
// their own tab rather than being appended to
// the end of one.

type Tab =
  | "account"
  | "ai"
  | "connections"
  | "people"
  | "skills"
  | "plan";

// A self-hosted copy has no plans to show.

const TABS: { id: Tab; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "ai", label: "AI" },
  { id: "connections", label: "Connections" },
  { id: "people", label: "People" },
  { id: "skills", label: "Skills" },
  ...(SELF_HOSTED ? [] : [{ id: "plan" as const, label: "Plan" }]),
];


// Usage is scoped to a channel when there is
// one, and to the project otherwise.

function scopeQuery(
  projectId: string,
  channelId: string | null
) {
  const query = new URLSearchParams({ projectId });

  if (channelId) {
    query.set("channelId", channelId);
  }

  return query.toString();
}


type Usage = {
  totalPromptTokens: number;
  totalResponseTokens: number;
  totalMs: number;
  turns: number;
  byModel: {
    model: string;
    tokens: number;
    turns: number;
  }[];
};


type ChannelAgent = {
  id: string;
  name: string;
  instructions: string | null;
  model: string | null;
};


// ==========================================
// TOGGLE
// ==========================================
//
// A plain track and knob. No icons inside, no
// colour beyond the accent when it is on.
//

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span className="min-w-0">
        <span className="block text-[13px] text-[var(--text)]">
          {label}
        </span>

        {hint && (
          <span className="mt-0.5 block text-[11.5px] leading-relaxed text-[var(--text-faint)]">
            {hint}
          </span>
        )}
      </span>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-[18px] w-[30px] shrink-0 rounded-full transition-colors ${
          checked
            ? "bg-[var(--accent)]"
            : "bg-[var(--border-strong)]"
        }`}
      >
        <span
          className={`absolute top-[3px] h-3 w-3 rounded-full bg-white transition-all ${
            checked ? "left-[15px]" : "left-[3px]"
          }`}
        />
      </button>
    </label>
  );
}


// ==========================================
// SETTINGS PANEL
// ==========================================

export default function SettingsPanel({
  open,
  onClose,
  settings,
  onChange,
  projectId,
  channelId,
  model,
  online,
  startTab,
}: {
  // Which tab to open on, when something outside
  // sent the person here for a reason.
  startTab?: "ai";

  open: boolean;
  onClose: () => void;
  settings: ChatSettings;
  onChange: (settings: ChatSettings) => void;
  projectId: string | null;
  channelId: string | null;
  model: string;
  online: boolean;
}) {
  const [tab, setTab] = useState<Tab>("account");

  // Back from a connect flow: show the tab it
  // started on.

  useEffect(() => {
    if (!open) {
      return;
    }

    void Promise.resolve().then(() => {
      if (startTab) {
        setTab(startTab);
      }

      if (
        new URLSearchParams(
          window.location.search
        ).has("connected")
      ) {
        setTab("connections");
      }
    });
  }, [open, startTab]);


  // When the panel opens, warm the other tabs' data in
  // the background, so moving from Account to
  // Connections, AI or Apps is instant rather than a
  // fresh load each time.
  useEffect(() => {
    if (!open) {
      return;
    }

    primeJson("/api/connections");

    primeJson(
      projectId
        ? `/api/models/keys?projectId=${projectId}`
        : "/api/models/keys"
    );

    primeJson(
      projectId
        ? `/api/mcp?projectId=${projectId}`
        : "/api/mcp"
    );

    if (projectId) {
      primeJson(
        `/api/projects/${projectId}/members?includeSelf=true`
      );

      primeJson(`/api/projects/${projectId}/skills`);
    }
  }, [open, projectId]);

  // Adding a key changes what the picker can
  // offer, so the two share a counter rather
  // than one owning the other's data.

  const [modelsChanged, setModelsChanged] =
    useState(0);

  // The model used where a channel has none of
  // its own. Lives on the profile rather than in
  // this panel's settings object, which never
  // left the browser.

  const [defaultModel, setDefaultModel] =
    useState("");

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    fetch("/api/models/choose", {
      cache: "no-store",
    })
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) {
          setDefaultModel(data.model ?? "");
        }
      })
      .catch(() => {
        // Shows the local default, which is what
        // it would have used anyway.
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const [usage, setUsage] =
    useState<Usage | null>(null);

  const [agent, setAgent] =
    useState<ChannelAgent | null>(null);

  const [agentDraft, setAgentDraft] = useState({
    name: "",
    instructions: "",

    // Which model this agent answers with, in
    // chat and in background runs alike. Empty
    // means the local one.
    model: "",
  });

  const [savingAgent, setSavingAgent] =
    useState(false);


  // Load usage and the channel agent whenever the
  // panel opens for a project.

  useEffect(() => {
    if (!open || !projectId) {
      return;
    }

    let cancelled = false;

    fetch(
      `/api/usage?${scopeQuery(
        projectId,
        channelId
      )}`
    )
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled && !data.error) {
          setUsage(data);
        }
      })
      .catch(() => {
        // Telemetry is optional.
      });

    if (channelId) {
      fetch(
        `/api/agents/channel?channelId=${channelId}`
      )
        .then((response) => response.json())
        .then((data) => {
          if (cancelled || !data.agent) {
            return;
          }

          setAgent(data.agent);

          setAgentDraft({
            name: data.agent.name ?? "",
            instructions:
              data.agent.instructions ?? "",
            model: data.agent.model ?? "",
          });
        })
        .catch(() => {
          // Falls back to the project agent.
        });
    } else {
      setAgent(null);
    }

    return () => {
      cancelled = true;
    };
  }, [open, projectId, channelId]);


  async function saveAgent() {
    if (!channelId) {
      return;
    }

    setSavingAgent(true);

    try {
      const response = await fetch(
        `/api/agents/channel?channelId=${channelId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(agentDraft),
        }
      );

      const data = await response.json();

      if (data.agent) {
        setAgent(data.agent);
      }
    } catch {
      // Leave the draft as it is so nothing is
      // lost; the next save can retry.
    } finally {
      setSavingAgent(false);
    }
  }


  // Kept on screen for its slide out (lib/ui/usePresence.ts).
  const presence = usePresence(open, 350);

  if (!presence.mounted) {
    return null;
  }

  const leaving = presence.closing ? " is-closing" : "";

  return (
    <div className={`fixed inset-0 z-40 flex justify-end${presence.closing ? " pointer-events-none" : ""}`}>
      <button
        type="button"
        aria-label="Close settings"
        onClick={onClose}
        className={`t-overlay${leaving} absolute inset-0 bg-black/50`}
      />

      <div className={`t-drawer-right${leaving} relative flex h-full w-full flex-col border-l sm:w-[420px] border-[var(--border)] bg-[var(--bg-panel)]`}>

        {/* HEADER */}

        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <h2 className="text-[13px] font-medium text-[var(--text)]">
            Settings
          </h2>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] sm:h-6 sm:w-6"
          >
            <Close className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
          </button>
        </div>


        {/* TABS */}

        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--border)] px-3 [scrollbar-width:none]">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`-mb-px shrink-0 border-b px-2.5 py-2.5 text-[12.5px] whitespace-nowrap transition sm:py-2 ${
                tab === item.id
                  ? "border-[var(--accent)] text-[var(--text)]"
                  : "border-transparent text-[var(--text-faint)] hover:text-[var(--text-muted)]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>


        {tab === "account" && (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <AccountSection />
          </div>
        )}

        {tab === "connections" && (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <ConnectionsSection />

            <McpSection
              projectId={projectId}
              onUpgrade={() => setTab("plan")}
            />
          </div>
        )}

        {tab === "plan" && (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <PlanSection projectId={projectId} />
          </div>
        )}

        {tab === "skills" && (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <SkillsSection projectId={projectId} />
          </div>
        )}

        {tab === "people" && (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <PeopleSection projectId={projectId} />
          </div>
        )}

        <div
          hidden={tab !== "ai"}
          className="flex-1 overflow-y-auto px-4 py-3"
        >

          {/* MODEL */}

          <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2.5">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                online
                  ? "bg-emerald-500"
                  : "bg-red-500"
              }`}
            />

            <span className="font-mono text-[12px] text-[var(--text)]">
              {model}
            </span>

            <span className="ml-auto text-[11px] text-[var(--text-faint)]">
              {online ? "Ollama" : "Offline"}
            </span>
          </div>


          {/* YOUR DEFAULT MODEL */}
          {/*                     */}
          {/* Used where a channel has not been */}
          {/* given one of its own. A channel   */}
          {/* that has is set from the composer */}
          {/* chip, because that choice is the  */}
          {/* channel's and everyone in it sees */}
          {/* the change.                       */}

          <p className="mt-5 mb-1.5 text-[10px] tracking-[0.12em] text-[var(--text-faint)] uppercase">
            Your default model
          </p>

          <ModelPicker
            value={defaultModel}
            projectId={projectId}
            refreshToken={modelsChanged}
            onChange={(chosen) => {
              setDefaultModel(chosen);

              void fetch("/api/models/choose", {
                method: "POST",

                headers: {
                  "Content-Type":
                    "application/json",
                },

                body: JSON.stringify({
                  model: chosen,
                  channelId: null,
                }),
              });
            }}
          />

          <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-faint)]">
            Kept on your account, so it follows
            you between devices.
          </p>


          {/* YOUR OWN KEYS */}

          <p className="mt-5 mb-1.5 text-[10px] tracking-[0.12em] text-[var(--text-faint)] uppercase">
            Connect a model service
          </p>

          <ModelKeys
            projectId={projectId}
            onUpgrade={() => setTab("plan")}
            onChanged={(change) => {
              setModelsChanged((n) => n + 1);

              if (change?.defaultModel) {
                setDefaultModel(change.defaultModel);
              }
            }}
          />


          {/* SHARED WITH THE PROJECT */}

          <p className="mt-5 mb-1.5 text-[10px] tracking-[0.12em] text-[var(--text-faint)] uppercase">
            Shared with this project
          </p>

          <ProjectKeys
            projectId={projectId}
            onUpgrade={() => setTab("plan")}
            onChanged={() =>
              setModelsChanged((n) => n + 1)
            }
          />


          {/* THIS CHANNEL'S AGENT */}

          {agent && (
            <>
              <p className="mt-5 mb-1.5 text-[10px] tracking-[0.12em] text-[var(--text-faint)] uppercase">
                This channel&apos;s agent
              </p>

              <input
                value={agentDraft.name}
                onChange={(event) =>
                  setAgentDraft((draft) => ({
                    ...draft,
                    name: event.target.value,
                  }))
                }
                placeholder="Research agent"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2 text-[13px] text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--border-strong)]"
              />

              <textarea
                value={agentDraft.instructions}
                onChange={(event) =>
                  setAgentDraft((draft) => ({
                    ...draft,
                    instructions:
                      event.target.value,
                  }))
                }
                rows={4}
                placeholder="Read and summarise. Never write files. Answer in short paragraphs."
                className="mt-2 w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2 text-[12.5px] leading-relaxed text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--border-strong)]"
              />


              {/* The model this agent uses when */}
              {/* it works on its own. Until now */}
              {/* a background run always used   */}
              {/* the local one, whatever had    */}
              {/* been picked in the composer.   */}

              <p className="mt-3 mb-1.5 text-[10px] tracking-[0.12em] text-[var(--text-faint)] uppercase">
                Model for background tasks
              </p>

              <ModelPicker
                value={agentDraft.model}
                projectId={projectId}
                refreshToken={modelsChanged}
                onChange={(chosen) =>
                  setAgentDraft((draft) => ({
                    ...draft,
                    model: chosen,
                  }))
                }
              />

              <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-faint)]">
                A hosted model here bills the key
                of whoever starts the task.
              </p>

              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={saveAgent}
                  disabled={savingAgent}
                  className="rounded-lg border border-[var(--border-strong)] px-2.5 py-1 text-[11.5px] text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)] disabled:opacity-40"
                >
                  {savingAgent ? "Saving…" : "Save"}
                </button>

                <span className="text-[11px] text-[var(--text-faint)]">
                  Only applies in this channel.
                </span>
              </div>
            </>
          )}


          {/* BEHAVIOUR */}

          <p className="mt-5 mb-1 text-[10px] tracking-[0.12em] text-[var(--text-faint)] uppercase">
            Behaviour
          </p>

          <div className="divide-y divide-[var(--border)]">
            <Toggle
              label="Conversation memory"
              hint="Recall a summary of older turns and remembered facts."
              checked={settings.useMemory}
              onChange={(value) =>
                onChange({
                  ...settings,
                  useMemory: value,
                })
              }
            />

            <Toggle
              label="File tools"
              hint="Let the agent create, read, edit and delete files."
              checked={settings.useTools}
              onChange={(value) =>
                onChange({
                  ...settings,
                  useTools: value,
                })
              }
            />

            <Toggle
              label="Web access"
              hint="Let the agent search the web and read pages. Treat what it finds as someone else's writing."
              checked={settings.useWeb}
              onChange={(value) =>
                onChange({
                  ...settings,
                  useWeb: value,
                })
              }
            />

            <Toggle
              label="Show reasoning"
              hint="Stream the model's thinking into a collapsible panel."
              checked={settings.showThinking}
              onChange={(value) =>
                onChange({
                  ...settings,
                  showThinking: value,
                })
              }
            />
          </div>


          {/* TEMPERATURE */}

          <div className="mt-4">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-[var(--text)]">
                Temperature
              </span>

              <span className="font-mono text-[12px] text-[var(--text-muted)]">
                {settings.temperature.toFixed(1)}
              </span>
            </div>

            <input
              type="range"
              min="0"
              max="1.5"
              step="0.1"
              value={settings.temperature}
              onChange={(event) =>
                onChange({
                  ...settings,
                  temperature: Number(
                    event.target.value
                  ),
                })
              }
              className="mt-2 w-full accent-[var(--accent)]"
            />

            <p className="mt-1 text-[11.5px] text-[var(--text-faint)]">
              Lower is more focused, higher is more
              varied.
            </p>
          </div>


          {/* INSTRUCTIONS */}

          <p className="mt-6 mb-1.5 text-[10px] tracking-[0.12em] text-[var(--text-faint)] uppercase">
            Custom instructions
          </p>

          <textarea
            value={settings.instructions}
            onChange={(event) =>
              onChange({
                ...settings,
                instructions: event.target.value,
              })
            }
            rows={4}
            placeholder="Always answer in British English. Prefer TypeScript examples."
            className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2 text-[12.5px] leading-relaxed text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--border-strong)]"
          />


          {/* USAGE */}

          {usage && usage.turns > 0 && (
            <>
              <p className="mt-6 mb-1.5 text-[10px] tracking-[0.12em] text-[var(--text-faint)] uppercase">
                Last 30 days
              </p>

              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] text-[var(--text)]">
                    {(
                      usage.totalPromptTokens +
                      usage.totalResponseTokens
                    ).toLocaleString()}{" "}
                    tokens
                  </span>

                  <span className="text-[11px] text-[var(--text-faint)]">
                    {usage.turns}{" "}
                    {usage.turns === 1
                      ? "turn"
                      : "turns"}
                  </span>
                </div>

                <p className="mt-1 text-[11.5px] text-[var(--text-faint)]">
                  {Math.round(
                    usage.totalMs /
                      1000 /
                      Math.max(usage.turns, 1)
                  )}
                  s average reply ·{" "}
                  {usage.byModel
                    .map((entry) => entry.model)
                    .join(", ")}
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
