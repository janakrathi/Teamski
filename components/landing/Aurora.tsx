"use client";

import { useEffect, useRef } from "react";


// ==========================================
// THE AURORA
// ==========================================
//
// Soft pastel light drifting behind the landing page:
// a handful of large, blurred colour pools - lagoon
// teal and lime, sky and mint, blossom pink and
// butter yellow - that wander on their own slow paths.
//
// Randomised on every visit (which colours, where they
// start, how they move), and the colours shift as the
// page is scrolled, from the cool greens at the top
// towards the warm pinks further down.
//
// Moved with transforms only, at most 30 times a
// second, paused while the tab is hidden. With reduced
// motion it is one still picture. Decorative.
//

type RGB = [number, number, number];

// Three moods, cool to warm, from light gradient
// swatches: lagoon, mint-and-sky, blossom.
const MOODS: RGB[][] = [
  [
    [45, 212, 191],
    [56, 189, 248],
    [163, 230, 53],
    [103, 232, 249],
  ],
  [
    [134, 239, 172],
    [125, 211, 252],
    [190, 242, 100],
    [165, 243, 252],
  ],
  [
    [249, 168, 212],
    [251, 113, 133],
    [253, 224, 71],
    [251, 207, 232],
  ],
];

const POOLS = 5;

function pick<T>(list: T[]) {
  return list[Math.floor(Math.random() * list.length)];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// A colour along the cool -> warm journey, for 0..1.
function along(colours: RGB[], progress: number) {
  const scaled = progress * (colours.length - 1);

  const index = Math.min(colours.length - 2, Math.floor(scaled));

  return mix(colours[index], colours[index + 1], scaled - index);
}

type Pool = {
  colours: RGB[];
  x: number;
  y: number;
  size: number;
  speed: number;
  phase: number;
  reachX: number;
  reachY: number;
};

export default function Aurora() {
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = layerRef.current;

    if (!layer) {
      return;
    }

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // This visit's pools: each takes one colour from each
    // mood, so it travels cool -> warm with the scroll.
    const pools: Pool[] = Array.from({ length: POOLS }, () => ({
      colours: MOODS.map((mood) => pick(mood)),
      x: 0.1 + Math.random() * 0.8,
      y: 0.05 + Math.random() * 0.9,
      size: 55 + Math.random() * 30,
      speed: 0.035 + Math.random() * 0.05,
      phase: Math.random() * Math.PI * 2,
      reachX: 0.12 + Math.random() * 0.18,
      reachY: 0.1 + Math.random() * 0.16,
    }));

    const nodes = pools.map((pool) => {
      const node = document.createElement("div");

      node.style.position = "absolute";
      node.style.left = "0";
      node.style.top = "0";
      node.style.width = `${pool.size}vmax`;
      node.style.height = `${pool.size}vmax`;
      node.style.borderRadius = "50%";
      node.style.mixBlendMode = "screen";
      node.style.willChange = "transform";

      layer.appendChild(node);

      return node;
    });

    let frame = 0;
    let last = 0;

    const painted: string[] = [];

    const draw = (time: number) => {
      const t = time / 1000;

      const scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);

      const progress = Math.min(1, window.scrollY / scrollable);

      const width = window.innerWidth;
      const height = window.innerHeight;

      pools.forEach((pool, index) => {
        const node = nodes[index];

        const size = (pool.size / 100) * Math.max(width, height);

        // A slow, looping wander - two sines at
        // different rates, so the path never quite
        // repeats.
        const x =
          (pool.x + Math.sin(t * pool.speed + pool.phase) * pool.reachX +
            Math.sin(t * pool.speed * 0.37 + pool.phase * 2) * pool.reachX * 0.5) *
            width -
          size / 2;

        const y =
          (pool.y + Math.cos(t * pool.speed * 0.8 + pool.phase) * pool.reachY) * height -
          size / 2 -
          // A touch of parallax.
          progress * height * 0.15;

        const [r, g, b] = along(pool.colours, progress);

        node.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;

        // Moving is a transform the GPU does for free;
        // repainting the gradient is not, so the colour is
        // only rewritten when scrolling has changed it.
        const colour = `${r},${g},${b}`;

        if (painted[index] === colour) {
          return;
        }

        painted[index] = colour;

        node.style.background = `radial-gradient(circle at center, rgba(${r}, ${g}, ${b}, 0.7) 0%, rgba(${r}, ${g}, ${b}, 0.32) 34%, rgba(${r}, ${g}, ${b}, 0) 66%)`;
      });
    };

    const loop = (time: number) => {
      frame = requestAnimationFrame(loop);

      if (document.hidden || time - last < 33) {
        return;
      }

      last = time;

      draw(time);
    };

    // The first picture at once, so nothing fades in late.
    draw(performance.now());

    const onScroll = () => {
      if (still) {
        draw(0);
      }
    };

    if (still) {
      window.addEventListener("scroll", onScroll, { passive: true });
    } else {
      frame = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      nodes.forEach((node) => node.remove());
    };
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-black">
      <div ref={layerRef} className="absolute inset-0 opacity-[0.8] saturate-[1.2]" />

      {/* A little darkness over the colour, deepest in the
          middle where most of the copy sits. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_70%_at_50%_45%,rgba(0,0,0,0.3),rgba(0,0,0,0.05)_70%)]" />
    </div>
  );
}
