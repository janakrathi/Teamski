"use client";

import { useEffect, useRef } from "react";


// ==========================================
// THE SIGNAL FIELD
// ==========================================
//
// The landing page's backdrop: a grid of short dashes
// that drift down the page like work moving through
// channels, brighter where a slow noise field peaks.
// A few cells catch the accent colour.
//
// Drawn on a canvas, at most 30 frames a second, only
// while it is on screen and the tab is visible. With
// reduced motion it draws one still frame. Decorative,
// so hidden from screen readers.
//

const CELL_X = 9;
const CELL_Y = 13;

// Integer hash -> 0..1, so the field is the same on
// every visit without storing anything.
function hash(x: number, y: number) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);

  h = Math.imul(h ^ (h >>> 13), 1274126177);

  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Smooth value noise.
function noise(x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);

  const xf = x - xi;
  const yf = y - yi;

  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);

  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);

  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export default function SignalField({
  // Where the field is calm, so copy over it stays
  // readable: "left" keeps the left half quiet (a hero
  // with text on the left), "center" the middle, and
  // "soft" keeps all of it faint - a band behind a
  // heading - and "page" is the whole-page backdrop:
  // soft everywhere, rising to the hero's strength
  // only while the top of the page is on screen.
  calm = "left",
  className = "",
  // How strong the lines are overall, 1 = as designed.
  intensity = 1,
  // For "page": how strong the lines at the top of the
  // page are, 1 = the hero's full strength.
  topStrength = 1,
}: {
  calm?: "left" | "center" | "soft" | "page";
  className?: string;
  intensity?: number;
  topStrength?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;

    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      return;
    }

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let frame = 0;
    let visible = true;
    let last = 0;

    const pointer = { x: -9999, y: -9999 };

    // For "page": how strongly the top and the bottom of
    // the page show - 1 while the opening (or the closing
    // call) is on screen, 0 a screen away. In between the
    // lines are barely there.
    let topWeight = 0;
    let bottomWeight = 0;

    // Graphics keep a clear background: anything marked
    // data-signal-clear has the lines wiped from behind it.
    let clear: Element[] = [];
    let clearFound = 0;

    // Fewer frames on phones and small machines - the
    // drift is slow enough that nobody sees the difference,
    // and the page scrolls smoother for it.
    const slow =
      window.innerWidth < 640 || (navigator.hardwareConcurrency ?? 8) <= 4;

    const interval = slow ? 66 : 42;

    const resize = () => {
      // Hairlines don't need a 2x canvas.
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);

      width = canvas.clientWidth;
      height = canvas.clientHeight;

      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);

      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    // How strong the field is at x, y (0 = nothing): copy
    // sits in the calm part, and the edges fade out.
    const mask = (x: number, y: number) => {
      const edgeY = Math.max(0, Math.min(1, y / (height * 0.18), (height - y) / (height * 0.28)));

      if (calm === "page") {
        const phone = width < 640;

        const edgeX = Math.max(0, Math.min(1, x / (width * 0.08), (width - x) / (width * 0.08)));

        const middle = (phone ? 0.1 : 0.14) * edgeX;

        let value = middle;

        if (topWeight > 0) {
          // Barely there behind the top bar, so its links
          // and buttons read clearly; full below it.
          const underBar = 0.12 + 0.88 * Math.max(0, Math.min(1, (y - 70) / 90));

          const hero =
            (phone
              ? 0.3
              : Math.max(0, Math.min(1, (x / width - 0.12) * 1.6)) * 0.9 + 0.1) *
            underBar *
            topStrength;

          value += (hero - middle) * topWeight;
        }

        if (bottomWeight > 0) {
          const dx = (x - width / 2) / (width / 2);
          const dy = (y - height / 2) / (height / 2);

          const closing = phone
            ? 0.3
            : Math.max(0, Math.min(1, Math.hypot(dx, dy * 1.4) - 0.25));

          value += (closing - middle) * bottomWeight;
        }

        return value;
      }

      // On a phone the copy spans the whole width, so
      // the whole field stays faint.
      if (width < 640) {
        return 0.3 * edgeY;
      }

      if (calm === "soft") {
        const edgeX = Math.min(1, x / (width * 0.12), (width - x) / (width * 0.12));

        return 0.42 * Math.max(0, Math.min(edgeX, edgeY));
      }

      if (calm === "center") {
        const dx = (x - width / 2) / (width / 2);
        const dy = (y - height / 2) / (height / 2);

        return Math.max(0, Math.min(1, Math.hypot(dx, dy * 1.4) - 0.25)) * edgeY;
      }

      return Math.max(0, Math.min(1, (x / width - 0.12) * 1.6)) * edgeY * 0.9 + 0.1 * edgeY;
    };

    const draw = (time: number) => {
      const t = time / 1000;

      context.clearRect(0, 0, width, height);

      if (calm === "page") {
        const scrollable = Math.max(1, document.documentElement.scrollHeight - height);

        topWeight = Math.max(0, 1 - window.scrollY / (height * 0.85));
        bottomWeight = Math.max(0, 1 - (scrollable - window.scrollY) / (height * 0.85));

        // The marked graphics, looked up again now and
        // then in case the page changed.
        if (time - clearFound > 1000 || clearFound === 0) {
          clear = Array.from(document.querySelectorAll("[data-signal-clear]"));
          clearFound = time || 1;
        }
      }

      const cols = Math.ceil(width / CELL_X);
      const rows = Math.ceil(height / CELL_Y);

      // One colour, varied with globalAlpha - far cheaper
      // than a new rgba() string for every dash.
      context.fillStyle = "#ededed";

      for (let col = 0; col < cols; col++) {
        // Each column drifts at its own pace.
        const speed = 0.25 + hash(col, 7) * 0.6;

        const x = col * CELL_X + 4;

        for (let row = 0; row < rows; row++) {
          const y = row * CELL_Y + 4;

          // Where the field is off, skip the noise too.
          const strength0 = mask(x, y) * intensity;

          if (strength0 <= 0.02) {
            continue;
          }

          const flow = noise(col * 0.11, row * 0.07 - t * speed);
          const swell = noise(col * 0.025 + t * 0.03, row * 0.04);

          let value = flow * (0.55 + swell * 0.7);

          // A soft lift near the pointer.
          const dx = x - pointer.x;
          const dy = y - pointer.y;

          if (dx * dx + dy * dy < 19600) {
            value += (1 - Math.sqrt(dx * dx + dy * dy) / 140) * 0.35;
          }

          const strength = (value - 0.42) * 2.2 * strength0;

          if (strength <= 0.02) {
            continue;
          }

          const tall = 2 + Math.round(Math.min(1, strength) * 5);

          if (hash(col, row) > 0.988) {
            context.fillStyle = "#c96442";
            context.globalAlpha = Math.min(1, strength * 1.4);
            context.fillRect(x, y + (7 - tall) / 2, 1.2, tall);
            context.fillStyle = "#ededed";
          } else {
            context.globalAlpha = Math.min(0.85, strength * 0.75);
            context.fillRect(x, y + (7 - tall) / 2, 1.2, tall);
          }
        }
      }

      context.globalAlpha = 1;

      // Wipe the lines from behind the graphics, with a
      // little room around each.
      for (const element of clear) {
        const rect = element.getBoundingClientRect();

        if (rect.bottom < -20 || rect.top > height + 20 || rect.width === 0) {
          continue;
        }

        context.clearRect(rect.left - 20, rect.top - 20, rect.width + 40, rect.height + 40);
      }
    };

    const loop = (time: number) => {
      frame = requestAnimationFrame(loop);

      if (!visible || document.hidden || time - last < interval) {
        return;
      }

      last = time;

      draw(time);
    };

    resize();

    const onResize = () => {
      resize();

      if (still) {
        draw(0);
      }
    };

    window.addEventListener("resize", onResize);

    const onMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();

      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
    };

    const onLeave = () => {
      pointer.x = -9999;
      pointer.y = -9999;
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });

    observer.observe(canvas);

    // A still page backdrop is redrawn as it scrolls, so
    // the hero's strength still eases off.
    const onStillScroll = () => draw(0);

    if (still) {
      draw(0);

      if (calm === "page") {
        window.addEventListener("scroll", onStillScroll, { passive: true });
      }
    } else {
      window.addEventListener("pointermove", onMove, { passive: true });
      document.addEventListener("pointerleave", onLeave);

      frame = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onStillScroll);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, [calm, intensity, topStrength]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  );
}
