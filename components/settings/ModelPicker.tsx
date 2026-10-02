"use client";

import { useEffect, useState } from "react";


// ==========================================
// WHICH MODEL ANSWERS
// ==========================================
//
// The choice matters beyond quality and price,
// so the panel says the part nobody else will:
// a local model keeps the conversation on this
// machine, and a hosted one sends it to a company
// that is not you.
//
// Only models this workspace can actually reach
// are listed. A hosted one with no key behind it
// is not a model you have.
//

type Model = {
  id: string;
  label: string;
  costPerMTokIn?: number;
  costPerMTokOut?: number;
};

type ProviderGroup = {
  service: string;
  label: string;
  local: boolean;
  models: Model[];
};


export default function ModelPicker({
  value,
  onChange,
  projectId,

  // Bumped when a key is added or removed, so
  // the list refetches without the panel having
  // to own the data.
  refreshToken = 0,
}: {
  value: string;
  onChange: (model: string) => void;

  // Decides whether the project's shared models
  // are on offer.
  projectId?: string | null;

  refreshToken?: number;
}) {
  const [groups, setGroups] = useState<
    ProviderGroup[]
  >([]);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch(
      `/api/models${
        projectId ? `?projectId=${projectId}` : ""
      }`,
      { cache: "no-store" }
    )
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) {
          setGroups(data.providers ?? []);
        }
      })
      .catch(() => {
        // The panel still works without it; the
        // model in use just has no list to sit
        // in.
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [refreshToken, projectId]);


  const chosen = groups
    .flatMap((group) =>
      group.models.map((model) => ({
        model,
        group,
      }))
    )
    .find((entry) => entry.model.id === value);

  // Nothing chosen means the local default, which
  // is what an existing workspace already had.

  const hosted = chosen
    ? !chosen.group.local
    : false;


  if (loading) {
    return (
      <p className="text-[12px] text-[var(--text-faint)]">
        Loading models…
      </p>
    );
  }


  return (
    <div>
      <div className="space-y-3">
        {groups.map((group) => (
          <div key={group.service}>
            <p className="mb-1 flex items-center gap-1.5 text-[10px] tracking-[0.12em] text-[var(--text-faint)] uppercase">
              {group.label}

              {group.local ? (
                <span className="rounded bg-emerald-950/60 px-1 py-px text-[9px] tracking-normal text-emerald-300 normal-case">
                  on this machine
                </span>
              ) : (
                <span className="rounded bg-amber-950/60 px-1 py-px text-[9px] tracking-normal text-amber-300 normal-case">
                  leaves this machine
                </span>
              )}
            </p>

            <div className="space-y-1">
              {group.models.map((model) => {
                const active =
                  model.id === value ||
                  (!value && group.local);

                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() =>
                      onChange(model.id)
                    }
                    className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition ${
                      active
                        ? "border-[var(--accent)] bg-[var(--bg-raised)]"
                        : "border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text)]">
                      {model.label}
                    </span>

                    {model.costPerMTokIn !==
                      undefined && (
                      <span className="shrink-0 text-[10.5px] text-[var(--text-faint)]">
                        ${model.costPerMTokIn} /
                        ${model.costPerMTokOut} per
                        Mtok
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>


      {/* -------------------------------- */}
      {/* WHAT CHOOSING THIS MEANS         */}
      {/* -------------------------------- */}

      {hosted ? (
        <p className="mt-3 rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-[11.5px] leading-relaxed text-amber-200">
          Your messages will be sent to{" "}
          {chosen?.group.label ?? "the provider"}{" "}
          and handled under its terms, on your key.
        </p>
      ) : (
        <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--text-faint)]">
          Answers come from Teamski&apos;s built-in
          model. Nothing about the conversation is
          sent to an AI provider.
        </p>
      )}

      <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--text-faint)]">
        A hosted model appears here once you have
        added a key for it below.
      </p>
    </div>
  );
}
