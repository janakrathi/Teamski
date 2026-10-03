"use client";

import { useCallback, useEffect, useState } from "react";

import { MAX_PREVIEW_BYTES, PREVIEWABLE, previewDocument } from "@/lib/preview";


// ==========================================
// LIVE PREVIEW OF A PAGE THE AGENT MADE
// ==========================================
//
// A "Preview" button beside an .html file the agent
// created. It opens the page full screen, at desktop or
// phone width, fenced in exactly as lib/preview.ts
// explains: a sandboxed srcdoc iframe with a strict
// policy, so the page can show itself and nothing
// more. "Reload" fetches the file again, to see the
// agent's latest edit.
//

export function canPreview(filename: string | null | undefined) {
  return Boolean(filename && PREVIEWABLE.test(filename));
}


export default function FilePreview({
  filename,
  projectId,
}: {
  filename: string;
  projectId: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 ml-2 inline-flex items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-raised)] px-3 py-2 text-[12px] font-medium text-[var(--text)] transition hover:text-white"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          className="h-4 w-4 text-[var(--accent)]"
          aria-hidden="true"
        >
          <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" strokeLinejoin="round" />
          <circle cx="12" cy="12" r="2.8" />
        </svg>
        Preview
      </button>

      {open && (
        <PreviewWindow
          filename={filename}
          projectId={projectId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}


function PreviewWindow({
  filename,
  projectId,
  onClose,
}: {
  filename: string;
  projectId: string;
  onClose: () => void;
}) {
  const [doc, setDoc] = useState<string | null>(null);
  const [raw, setRaw] = useState("");
  const [error, setError] = useState("");
  const [phone, setPhone] = useState(false);
  const [code, setCode] = useState(false);

  // What the page itself reported: a script error, or
  // that it ended up showing nothing.
  const [problem, setProblem] = useState("");

  // Bumped by Reload, so the iframe is rebuilt even
  // when the page is unchanged.
  const [version, setVersion] = useState(0);

  const url = `/api/files/${encodeURIComponent(filename)}?projectId=${encodeURIComponent(projectId)}`;

  const apply = useCallback((outcome: Loaded) => {
    if ("doc" in outcome) {
      setError("");
      setProblem("");
      setDoc(outcome.doc);
      setRaw(outcome.raw);
      setVersion((current) => current + 1);
    } else {
      setError(outcome.error);
    }
  }, []);

  useEffect(() => {
    let live = true;

    void fetchPreview(url).then((outcome) => {
      if (live) {
        apply(outcome);
      }
    });

    return () => {
      live = false;
    };
  }, [url, apply]);

  const reload = () => {
    void fetchPreview(url).then(apply);
  };

  // Messages from the preview. Only ever from our own
  // iframe, and only these two shapes are read.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { teamskiPreview?: boolean; error?: unknown; empty?: unknown };

      if (!data || data.teamskiPreview !== true || event.origin !== "null") {
        return;
      }

      if (typeof data.error === "string") {
        setProblem(`The page's script stopped with an error: ${data.error.slice(0, 160)}`);
      } else if (data.empty === true) {
        setProblem((current) => current || "The page loaded but shows nothing. Check the Code view, or ask the agent to rebuild it.");
      }
    };

    window.addEventListener("message", onMessage);

    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Escape closes it, and the chat behind does not
  // scroll while it is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    const overflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const toggle =
    "rounded-md px-2.5 py-1 text-[12px] transition";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${filename}`}
      className="fixed inset-0 z-[80] flex flex-col bg-black/70 backdrop-blur-sm"
    >
      <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-panel)] px-3 py-2 sm:px-4">
        <span className="min-w-0 truncate text-[13px] font-medium text-[var(--text)]">
          {filename}
        </span>

        <span className="hidden text-[11px] text-[var(--text-faint)] sm:inline">
          Preview · links and forms are switched off
        </span>

        <div className="ml-auto flex items-center gap-1 rounded-lg border border-[var(--border)] p-0.5">
          <button
            type="button"
            onClick={() => {
              setPhone(false);
              setCode(false);
            }}
            className={`${toggle} ${!phone && !code ? "bg-[var(--bg-raised)] text-[var(--text)]" : "text-[var(--text-muted)] hover:text-[var(--text)]"}`}
          >
            Desktop
          </button>

          <button
            type="button"
            onClick={() => {
              setPhone(true);
              setCode(false);
            }}
            className={`${toggle} ${phone && !code ? "bg-[var(--bg-raised)] text-[var(--text)]" : "text-[var(--text-muted)] hover:text-[var(--text)]"}`}
          >
            Phone
          </button>

          <button
            type="button"
            onClick={() => setCode(true)}
            className={`${toggle} ${code ? "bg-[var(--bg-raised)] text-[var(--text)]" : "text-[var(--text-muted)] hover:text-[var(--text)]"}`}
          >
            Code
          </button>
        </div>

        <button
          type="button"
          onClick={reload}
          className="rounded-md px-2.5 py-1 text-[12px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
        >
          Reload
        </button>

        <a
          href={url}
          className="hidden rounded-md px-2.5 py-1 text-[12px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] sm:inline"
        >
          Download
        </a>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="rounded-md px-2.5 py-1 text-[16px] leading-none text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
        >
          ×
        </button>
      </div>

      {problem && !code && (
        <div className="border-b border-amber-900/40 bg-amber-950/40 px-4 py-2 text-[12.5px] text-amber-200">
          {problem}{" "}
          <button type="button" onClick={() => setCode(true)} className="underline underline-offset-2">
            View code
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 justify-center overflow-auto p-0 sm:p-4">
        {code && doc !== null ? (
          <pre className="h-full w-full overflow-auto rounded-none bg-[var(--bg-panel)] p-4 text-[12px] leading-[1.55] whitespace-pre-wrap text-[var(--text-muted)] sm:rounded-lg">
            {raw}
          </pre>
        ) : error ? (
          <p className="self-center rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] px-4 py-3 text-[13px] text-[var(--text-muted)]">
            {error}
          </p>
        ) : doc === null ? (
          <p className="self-center text-[13px] text-[var(--text-muted)]">Loading…</p>
        ) : (
          <iframe
            key={version}
            title={`Preview of ${filename}`}
            srcDoc={doc}
            // Scripts only. No allow-same-origin, so the
            // page can never reach the app; no forms,
            // popups or top navigation.
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            className={`h-full rounded-none border-0 bg-white sm:rounded-lg ${
              phone ? "w-[390px] max-w-full sm:shadow-2xl" : "w-full"
            }`}
          />
        )}
      </div>
    </div>
  );
}


type Loaded = { doc: string; raw: string } | { error: string };

// The file, made safe to show, or why it could not be.

async function fetchPreview(url: string): Promise<Loaded> {
  try {
    const response = await fetch(url, { cache: "no-store" });

    if (!response.ok) {
      return {
        error:
          response.status === 404
            ? "That file isn't there any more."
            : "The page couldn't be loaded.",
      };
    }

    const size = Number(response.headers.get("content-length") ?? 0);

    if (size > MAX_PREVIEW_BYTES) {
      return { error: "That page is too large to preview. Download it instead." };
    }

    const text = await response.text();

    if (!text.trim()) {
      return { error: "This file is empty - the agent may have run out of room. Ask it to create the page again." };
    }

    if (!/<[a-z!][^>]*>/i.test(text)) {
      return { error: "This file doesn't contain a web page. Ask the agent to write it as HTML." };
    }

    return { doc: previewDocument(text), raw: text };
  } catch {
    return { error: "The page couldn't be loaded." };
  }
}
