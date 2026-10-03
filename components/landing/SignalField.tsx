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
  // with text on the left), "center" the middle.
  calm = "left",
  className = "",
}: {
  calm?: "left" | "center";
  className?: string;
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

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);

      width = canvas.clientWidth;
      height = canvas.clientHeight;

      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);

      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    // How quiet the field is at x, y: copy sits in the
    // calm part, and the edges fade out.
    const mask = (x: number, y: number) => {
      // On a phone the copy spans the whole width, so
      // the whole field stays faint.
      if (width < 640) {
        return 0.3 * Math.max(0, Math.min(1, y / (height * 0.18), (height - y) / (height * 0.28)));
      }

      const edgeY = Math.min(1, y / (height * 0.18), (height - y) / (height * 0.28));

      if (calm === "center") {
        const dx = (x - width / 2) / (width / 2);
        const dy = (y - height / 2) / (height / 2);

        return Math.max(0, Math.min(1, Math.hypot(dx, dy * 1.4) - 0.25)) * Math.max(0, edgeY);
      }

      const fromLeft = x / width;

      return Math.max(0, Math.min(1, (fromLeft - 0.12) * 1.6)) * Math.max(0, edgeY) * 0.9 + 0.1 * Math.max(0, edgeY);
    };

    const draw = (time: number) => {
      const t = time / 1000;

      context.clearRect(0, 0, width, height);

      const cols = Math.ceil(width / CELL_X);
      const rows = Math.ceil(height / CELL_Y);

      for (let col = 0; col < cols; col++) {
        // Each column drifts at its own pace.
        const speed = 0.25 + hash(col, 7) * 0.6;

        for (let row = 0; row < rows; row++) {
          const x = col * CELL_X + 4;
          const y = row * CELL_Y + 4;

          const flow = noise(col * 0.11, row * 0.07 - t * speed);
          const swell = noise(col * 0.025 + t * 0.03, row * 0.04);

          let value = flow * (0.55 + swell * 0.7);

          // A soft lift near the pointer.
          const near = Math.hypot(x - pointer.x, y - pointer.y);

          if (near < 140) {
            value += (1 - near / 140) * 0.35;
          }

          const strength = (value - 0.42) * 2.2 * mask(x, y);

          if (strength <= 0.02) {
            continue;
          }

          const accent = hash(col, row) > 0.988;

          context.fillStyle = accent
            ? `rgba(201, 100, 66, ${Math.min(1, strength * 1.4)})`
            : `rgba(237, 237, 237, ${Math.min(0.85, strength * 0.75)})`;

          const tall = 2 + Math.round(Math.min(1, strength) * 5);

          context.fillRect(x, y + (7 - tall) / 2, 1.2, tall);
        }
      }
    };

    const loop = (time: number) => {
      frame = requestAnimationFrame(loop);

      if (!visible || document.hidden || time - last < 33) {
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

    if (still) {
      draw(0);
    } else {
      window.addEventListener("pointermove", onMove, { passive: true });
      document.addEventListener("pointerleave", onLeave);

      frame = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, [calm]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  );
}
