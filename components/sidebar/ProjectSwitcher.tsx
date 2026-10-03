"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  Check,
  ChevronDown,
  Plus,
} from "@/components/ui/Icons";

import type { Project } from "@/components/types";


// ==========================================
// PROJECT SWITCHER
// ==========================================
//
// Collapsed it shows only the project you are
// in. Open it lists the rest, so the sidebar
// stays about the current project instead of
// every project at once.
//

export default function ProjectSwitcher({
  projects,
  current,
  onSelect,
  onCreate,
  onRename,
}: {
  projects: Project[];
  current: Project | null;
  onSelect: (project: Project) => void;
  onCreate: () => void;
  onRename: (project: Project) => void;
}) {
  const [open, setOpen] = useState(false);

  const containerRef =
    useRef<HTMLDivElement>(null);


  // Close on an outside click or Escape.

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(
          event.target as Node
        )
      ) {
        setOpen(false);
      }
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener(
      "mousedown",
      onPointerDown
    );

    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener(
        "mousedown",
        onPointerDown
      );

      document.removeEventListener(
        "keydown",
        onKey
      );
    };
  }, [open]);


  const initial = (current?.name ?? "?")
    .charAt(0)
    .toUpperCase();

  return (
    <div
      ref={containerRef}
      className="relative px-2 pt-3"
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-[var(--bg-hover)]"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--accent-soft)] text-[11px] font-semibold text-[var(--accent)]">
          {initial}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-[var(--text)]">
            {current?.name ?? "No project"}
          </span>
        </span>

        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-[var(--text-faint)] transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>


      {/* ---------------------------------- */}
      {/* DROPDOWN                           */}
      {/* ---------------------------------- */}

      {open && (
        <div data-origin="top-center" className="t-dropdown absolute inset-x-2 top-full z-30 mt-1 overflow-hidden rounded-lg border border-[var(--border-strong)] bg-[var(--bg-raised)] py-1 shadow-xl shadow-black/40">
          <p className="px-3 py-1.5 text-[10px] tracking-[0.12em] text-[var(--text-faint)] uppercase">
            Projects
          </p>

          <div className="max-h-64 overflow-y-auto">
            {projects.length === 0 && (
              <p className="px-3 py-2 text-[12px] text-[var(--text-faint)]">
                No projects yet.
              </p>
            )}

            {projects.map((project) => {
              const active =
                project.id === current?.id;

              return (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => {
                    onSelect(project);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition hover:bg-[var(--bg-hover)]"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text)]">
                    {project.name}
                  </span>

                  {/* A short, stable handle for the
                      project - the start of its id, so
                      people can name which project they
                      mean. */}
                  <span className="shrink-0 font-mono text-[11px] tracking-tight text-[var(--text-faint)]">
                    #{project.id.slice(0, 6)}
                  </span>

                  {active && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="my-1 h-px bg-[var(--border)]" />

          {current && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onRename(current);
              }}
              className="flex w-full items-center px-3 py-1.5 text-left text-[13px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
            >
              Rename “{current.name}”
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onCreate();
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            <Plus className="h-3.5 w-3.5" />
            New project
          </button>
        </div>
      )}
    </div>
  );
}
