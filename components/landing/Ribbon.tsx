"use client";

import { useEffect, useRef } from "react";


// ==========================================
// THE LIGHT RIBBON
// ==========================================
//
// A silky band of light flowing behind the public site:
// two ribbons of fine strands that curve, twist (the
// band pinches to a bright knot where it flips over),
// fold back over themselves and drift slowly. Their
// height follows the scroll, so the light runs from one
// section into the next instead of each section ending
// in a hard edge.
//
// Only Teamski's own tones: lavender, violet, white.
//
// Drawn at half resolution - which is what makes it
// soft - with the strands added together ("lighter"),
// at most 30 frames a second (20 on phones and small
// machines), only while the tab is visible. With
// reduced motion it is one still picture. Decorative.
//

type RGB = [number, number, number];

const LAVENDER: RGB = [214, 196, 255];
const VIOLET: RGB = [167, 139, 250];
const WHITE: RGB = [245, 243, 255];

type RibbonShape = {
  // Where the band runs, as fractions of the window.
  x: (t: number, time: number) => number;
  y: (t: number, time: number, drift: number) => number;
  // Its widest, as a fraction of the window height.
  width: number;
  // How many times it flips over along its length.
  twists: number;
  twistSpeed: number;
  phase: number;
  colour: RGB;
  edge: RGB;
  strength: number;
};

const TAU = Math.PI * 2;

const RIBBONS: RibbonShape[] = [
  {
    // The main ribbon, left to right, folding over itself
    // where its sideways swing outruns its travel.
    x: (t, time) =>
      -0.15 + 1.3 * t + 0.19 * Math.sin(TAU * 1.5 * t + time * 0.05),
    y: (t, time, drift) =>
      drift +
      0.17 * Math.sin(TAU * (0.85 * t + 0.1) + time * 0.11) +
      0.07 * Math.sin(TAU * 2.1 * t - time * 0.17),
    width: 0.16,
    twists: 2.4,
    twistSpeed: 0.22,
    phase: 0,
    colour: VIOLET,
    edge: LAVENDER,
    strength: 1,
  },
  {
    // A fainter one crossing back the other way.
    x: (t, time) => 1.12 - 1.25 * t + 0.08 * Math.sin(TAU * t + time * 0.04),
    y: (t, time, drift) =>
      1 -
      drift * 0.9 +
      0.14 * Math.sin(TAU * (0.7 * t + 0.35) - time * 0.09) +
      0.05 * Math.sin(TAU * 1.7 * t + time * 0.13),
    width: 0.1,
    twists: 1.6,
    twistSpeed: -0.16,
    phase: 1.7,
    colour: LAVENDER,
    edge: WHITE,
    strength: 0.6,
  },
];

const SEGMENTS = 72;

export default function Ribbon({
  // Overall brightness, 1 = as designed.
  strength = 1,
}: {
  strength?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;

    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      return;
    }

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const slow = window.innerWidth < 640 || (navigator.hardwareConcurrency ?? 8) <= 4;

    const strands = slow ? 22 : 38;

    const interval = slow ? 50 : 33;

    // Half resolution (less on phones): softer, and a
    // fraction of the pixels.
    const SCALE = slow ? 0.4 : 0.5;

    let width = 0;
    let height = 0;
    let frame = 0;
    let last = 0;

    const cx = new Float32Array(SEGMENTS + 1);
    const cy = new Float32Array(SEGMENTS + 1);
    const nx = new Float32Array(SEGMENTS + 1);
    const ny = new Float32Array(SEGMENTS + 1);

    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;

      canvas.width = Math.max(1, Math.round(width * SCALE));
      canvas.height = Math.max(1, Math.round(height * SCALE));

      context.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    };

    const rgba = ([r, g, b]: RGB, alpha: number) =>
      `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;

    const draw = (now: number) => {
      const time = now / 1000;

      context.globalCompositeOperation = "source-over";
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = "lighter";

      // The band's height follows the scroll, so it flows
      // through the sections as the page moves.
      const scrolled = window.scrollY / Math.max(1, height);

      const drift = 0.5 + 0.22 * Math.sin(scrolled * 1.15 + 0.6);

      for (const ribbon of RIBBONS) {
        // The centre line, and the direction across it.
        for (let k = 0; k <= SEGMENTS; k++) {
          const t = k / SEGMENTS;

          cx[k] = ribbon.x(t, time) * width;
          cy[k] = ribbon.y(t, time, drift) * height;
        }

        for (let k = 0; k <= SEGMENTS; k++) {
          const a = Math.max(0, k - 1);
          const b = Math.min(SEGMENTS, k + 1);

          const dx = cx[b] - cx[a];
          const dy = cy[b] - cy[a];

          const length = Math.hypot(dx, dy) || 1;

          nx[k] = -dy / length;
          ny[k] = dx / length;
        }

        const band = ribbon.width * height;

        // A soft glow along the middle first.
        for (const [lineWidth, alpha] of [
          [band * 0.9, 0.018],
          [band * 0.45, 0.026],
        ] as const) {
          context.lineWidth = lineWidth;
          context.strokeStyle = rgba(ribbon.colour, alpha * ribbon.strength * strength);
          context.lineCap = "round";
          context.beginPath();

          for (let k = 0; k <= SEGMENTS; k++) {
            if (k === 0) context.moveTo(cx[k], cy[k]);
            else context.lineTo(cx[k], cy[k]);
          }

          context.stroke();
        }

        // Then the strands - the fabric. The edges catch
        // more light than the middle, as silk does.
        context.lineWidth = 1.4;

        for (let s = 0; s < strands; s++) {
          const across = s / (strands - 1) - 0.5;

          const edge = Math.abs(across) * 2;

          const alpha = (0.035 + 0.11 * edge * edge) * ribbon.strength * strength;

          context.strokeStyle = rgba(edge > 0.8 ? ribbon.edge : ribbon.colour, alpha);
          context.beginPath();

          for (let k = 0; k <= SEGMENTS; k++) {
            const t = k / SEGMENTS;

            // Narrow at the ends, full in the middle,
            // flipping over where the twist crosses zero.
            const taper = Math.sin(Math.PI * t);

            const twist = Math.sin(
              t * ribbon.twists * Math.PI + time * ribbon.twistSpeed + ribbon.phase
            );

            const offset = across * band * (0.25 + 0.75 * taper) * twist;

            const x = cx[k] + nx[k] * offset;
            const y = cy[k] + ny[k] * offset;

            if (k === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
          }

          context.stroke();
        }
      }

      context.globalCompositeOperation = "source-over";
    };

    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);

      if (document.hidden || now - last < interval) {
        return;
      }

      last = now;

      draw(now);
    };

    resize();
    draw(performance.now());

    const onResize = () => {
      resize();
      draw(performance.now());
    };

    const onStillScroll = () => draw(0);

    window.addEventListener("resize", onResize);

    if (still) {
      window.addEventListener("scroll", onStillScroll, { passive: true });
    } else {
      frame = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onStillScroll);
    };
  }, [strength]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
    />
  );
}
