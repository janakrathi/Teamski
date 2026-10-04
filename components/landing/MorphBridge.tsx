"use client";

import { useEffect, useRef } from "react";


// ==========================================
// ONE BOX BECOMING THE NEXT
// ==========================================
//
// Scrolling from the channel preview to the "how it
// works" window, the first box doesn't just scroll away:
// it shrinks, hops down behind the heading between them,
// and grows into the window below - which then shows its
// own content. Scrolling back up plays it in reverse.
//
// Driven by the scroll position, not by time, so it is
// always exactly where the reader is. The two real boxes
// are marked data-morph="from" and data-morph="to"; while
// the hand-over runs they step aside and a stand-in box
// (fixed, behind the page's text) makes the journey.
//
// Cheap: one small fixed element is moved and resized, and
// the boxes' positions are measured only when the page
// changes size. With reduced motion nothing moves and both
// boxes simply stay put.
//

type Box = { top: number; left: number; width: number; height: number };

// The box's place on the page, ignoring any transform it
// is mid-way through (a reveal animation).
function measure(element: HTMLElement): Box {
  let top = 0;
  let left = 0;
  let node: HTMLElement | null = element;

  while (node) {
    top += node.offsetTop;
    left += node.offsetLeft;
    node = node.offsetParent as HTMLElement | null;
  }

  return { top, left, width: element.offsetWidth, height: element.offsetHeight };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export default function MorphBridge() {
  const shellRef = useRef<HTMLDivElement>(null);
  const fromLabelRef = useRef<HTMLSpanElement>(null);
  const toLabelRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const shell = shellRef.current;
    const fromLabel = fromLabelRef.current;
    const toLabel = toLabelRef.current;

    const from = document.querySelector<HTMLElement>('[data-morph="from"]');
    const to = document.querySelector<HTMLElement>('[data-morph="to"]');

    if (!shell || !fromLabel || !toLabel || !from || !to) {
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    let a = measure(from);
    let b = measure(to);
    let frame = 0;

    // Where the journey was last frame, to notice a box
    // being handed back.
    let previous: number | null = null;

    // A box that has just taken over again plays its own
    // content in afresh (app/globals.css, data-replay),
    // rather than appearing with it already in place.
    const replay = (box: HTMLElement) => {
      box.dataset.replay = "1";
      void box.offsetWidth;
      delete box.dataset.replay;
    };

    const remeasure = () => {
      a = measure(from);
      b = measure(to);

      update();
    };

    const update = () => {
      frame = 0;

      const height = window.innerHeight;

      // From the first box sitting in the middle of the
      // screen to the second one sitting there.
      const start = a.top + a.height / 2 - height / 2;
      const end = b.top + b.height / 2 - height / 2;

      const p = clamp((window.scrollY - start) / Math.max(1, end - start));

      if (previous !== null) {
        if (previous < 0.94 && p >= 0.94) replay(to);
        if (previous > 0.06 && p <= 0.06) replay(from);
      }

      previous = p;

      // Before and after, the real boxes; in between, the
      // stand-in.
      const moving = p > 0 && p < 1;

      from.style.opacity = p <= 0 ? "" : String(clamp(1 - p / 0.06));
      to.style.opacity = p >= 1 ? "" : String(clamp((p - 0.94) / 0.06));

      shell.style.visibility = moving ? "visible" : "hidden";

      if (!moving) {
        return;
      }

      const t = ease(p);

      // Small in the middle of the journey, with a little
      // hop upward as it goes.
      const shrink = 1 - 0.48 * Math.sin(Math.PI * p);

      const width = (a.width + (b.width - a.width) * t) * shrink;
      const boxHeight = (a.height + (b.height - a.height) * t) * shrink;

      const centreX = a.left + a.width / 2 + (b.left + b.width / 2 - (a.left + a.width / 2)) * t;
      const centreY =
        a.top + a.height / 2 + (b.top + b.height / 2 - (a.top + a.height / 2)) * t -
        window.scrollY -
        height * 0.06 * Math.sin(Math.PI * p);

      shell.style.width = `${width.toFixed(1)}px`;
      shell.style.height = `${boxHeight.toFixed(1)}px`;
      shell.style.transform = `translate3d(${(centreX - width / 2).toFixed(1)}px, ${(centreY - boxHeight / 2).toFixed(1)}px, 0)`;

      // What the box is: the channel on the way out, the
      // window on the way in.
      fromLabel.style.opacity = String(clamp(1 - p / 0.45));
      toLabel.style.opacity = String(clamp((p - 0.55) / 0.35));
    };

    const onScroll = () => {
      if (!frame) {
        frame = requestAnimationFrame(update);
      }
    };

    remeasure();

    const sizes = new ResizeObserver(remeasure);

    sizes.observe(document.body);

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", remeasure);

    return () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", remeasure);

      from.style.opacity = "";
      to.style.opacity = "";
    };
  }, []);

  return (
    <div
      ref={shellRef}
      aria-hidden="true"
      style={{ visibility: "hidden" }}
      className="pointer-events-none fixed top-0 left-0 -z-[1] overflow-hidden rounded-2xl border border-white/12 bg-[#050505] shadow-[0_30px_90px_-30px_rgba(139,92,246,0.45)] will-change-transform"
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-white/15" />
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-white/15" />
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-white/15" />

        <span className="relative ml-3 h-4 min-w-0 flex-1">
          <span ref={fromLabelRef} className="absolute inset-0 truncate text-[12px] text-white/70">
            # planning · Planning agent
          </span>

          <span ref={toLabelRef} className="absolute inset-0 truncate text-[12px] text-white/45" style={{ opacity: 0 }}>
            Teamski · how it works
          </span>
        </span>
      </div>

      {/* Lines of content, blurred in passing. */}
      <div className="space-y-3 px-5 py-5">
        <div className="h-2 w-2/3 rounded-full bg-white/[0.07]" />
        <div className="h-2 w-5/6 rounded-full bg-white/[0.05]" />
        <div className="h-2 w-1/2 rounded-full bg-white/[0.05]" />
        <div className="h-2 w-3/4 rounded-full bg-[rgba(167,139,250,0.12)]" />
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-[radial-gradient(ellipse_at_50%_100%,rgba(167,139,250,0.14),transparent_70%)]" />
    </div>
  );
}
