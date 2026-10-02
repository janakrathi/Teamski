"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Sidebar as SidebarIcon } from "@/components/ui/Icons";


// ==========================================
// A SIDEBAR YOU CAN RESIZE AND HIDE
// ==========================================
//
// The edge of the sidebar is a handle. Hover it
// and a small bar appears with a hint; drag it to
// make the sidebar wider or narrower, click it -
// or press Ctrl+B anywhere - to hide the sidebar.
// Dragging it most of the way closed hides it too.
//
// Hidden, the sidebar leaves a thin rail with one
// button to bring it back, so the way back is
// always on screen rather than only a shortcut
// you have to know.
//
// Width and hidden-ness are remembered in this
// browser. They are read after the first render,
// not during it: the server cannot see
// localStorage, and a first render that differed
// from the server's would not hydrate.
//

const STORAGE_KEY = "teamski.sidebar";

export const SIDEBAR_DEFAULT = 240;
const MIN = 200;
const MAX = 420;

// Let go narrower than this and it closes.
const CLOSE_BELOW = 140;

// Less movement than this is a click, not a drag.
const CLICK_SLOP = 3;


type Layout = { width: number; hidden: boolean };

const clamp = (width: number) => Math.min(MAX, Math.max(MIN, width));


export function useSidebarLayout() {
  const [layout, setLayout] = useState<Layout>({
    width: SIDEBAR_DEFAULT,
    hidden: false,
  });

  const loaded = useRef(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");

      if (saved && typeof saved.width === "number") {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
        setLayout({ width: clamp(saved.width), hidden: Boolean(saved.hidden) });
      }
    } catch {
      // Storage can be unavailable.
    }

    loaded.current = true;
  }, []);

  useEffect(() => {
    if (!loaded.current) {
      return;
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // Storage can be unavailable.
    }
  }, [layout]);

  const toggle = useCallback(
    () => setLayout((now) => ({ ...now, hidden: !now.hidden })),
    []
  );

  // Ctrl+B (Cmd+B on a Mac), wherever focus is.

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "b"
      ) {
        event.preventDefault();
        toggle();
      }
    }

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return {
    width: layout.width,
    hidden: layout.hidden,
    toggle,
    setWidth: (width: number) =>
      setLayout({ width: clamp(width), hidden: false }),
    hide: (restoreWidth: number) =>
      setLayout({ width: clamp(restoreWidth), hidden: true }),
  };
}


const shortcut = () =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⌘ B"
    : "Ctrl B";


// ------------------------------------------
// THE HANDLE ON THE SIDEBAR'S EDGE
// ------------------------------------------

export function ResizeHandle({
  width,
  onResize,
  onHide,
}: {
  width: number;
  onResize: (width: number) => void;

  // Given the width to come back at.
  onHide: (restoreWidth: number) => void;
}) {
  const [hover, setHover] = useState<{ y: number; left: number } | null>(
    null
  );
  const [dragging, setDragging] = useState(false);

  const start = useRef<{ x: number; width: number; moved: boolean } | null>(
    null
  );

  // Where the hint goes: just right of the edge,
  // a little below the pointer.

  function track(event: React.PointerEvent<HTMLDivElement>) {
    setHover({
      y: event.clientY,
      left: event.currentTarget.getBoundingClientRect().right + 6,
    });
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    start.current = { x: event.clientX, width, moved: false };
    setDragging(true);

    // No text gets selected while dragging, and the
    // cursor stays a resize cursor even when it
    // runs ahead of the handle.
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    track(event);

    const from = start.current;

    if (!from) {
      return;
    }

    const dx = event.clientX - from.x;

    if (Math.abs(dx) >= CLICK_SLOP) {
      from.moved = true;
    }

    if (from.moved) {
      onResize(from.width + dx);
    }
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const from = start.current;

    start.current = null;
    setDragging(false);

    document.body.style.userSelect = "";
    document.body.style.cursor = "";

    if (!from) {
      return;
    }

    const dropped = from.width + (event.clientX - from.x);

    if (!from.moved) {
      onHide(from.width);
    } else if (dropped < CLOSE_BELOW) {
      onHide(from.width);
    }
  }

  const active = dragging || hover !== null;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      aria-valuenow={width}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") onResize(width - 16);
        if (event.key === "ArrowRight") onResize(width + 16);
        if (event.key === "Enter" || event.key === " ") onHide(width);
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerEnter={track}
      onPointerLeave={() => !dragging && setHover(null)}
      className="group absolute top-0 -right-[5px] z-30 flex h-full w-[10px] cursor-col-resize items-center justify-center outline-none"
    >
      {/* The bar that shows it can be grabbed. */}
      <span
        className={`h-12 w-[3px] rounded-full bg-[var(--text-muted)] transition-opacity duration-150 group-focus-visible:opacity-100 ${
          active ? "opacity-100" : "opacity-0"
        }`}
      />

      {hover && !dragging && (
        <span
          role="tooltip"
          style={{ top: hover.y + 18, left: hover.left }}
          className="pointer-events-none fixed rounded-lg border border-[var(--border-strong)] bg-[var(--bg-panel)] px-2.5 py-1.5 whitespace-nowrap shadow-lg"
        >
          <span className="flex items-center gap-3 text-[12.5px] font-medium text-[var(--text)]">
            Hide sidebar
            <span className="font-normal text-[var(--text-faint)]">{shortcut()}</span>
          </span>

          <span className="block text-[11.5px] text-[var(--text-muted)]">
            Drag to resize
          </span>
        </span>
      )}
    </div>
  );
}


// ------------------------------------------
// WHAT IS LEFT WHEN IT IS HIDDEN
// ------------------------------------------

export function CollapsedRail({ onShow }: { onShow: () => void }) {
  return (
    <div className="flex w-11 shrink-0 flex-col items-center border-r border-[var(--border)] bg-[var(--bg-panel)] pt-2.5">
      <button
        type="button"
        onClick={onShow}
        aria-label="Show sidebar"
        title={`Show sidebar (${shortcut()})`}
        className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
      >
        <SidebarIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
