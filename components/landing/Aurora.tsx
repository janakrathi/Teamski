"use client";

import { useEffect, useRef } from "react";


// ==========================================
// THE AURORA
// ==========================================
//
// A quiet second tone behind the landing page's black:
// a few large, soft pools of muted colour - dusty
// mauve, smoky sage, cool slate - drifting on their own
// slow paths. Black stays the background; this is only
// a low light moving through it.
//
// Randomised on every visit (which tones, where they
// start, how they move). Each pool is painted once and
// then only moved, a transform the GPU does for free -
// at most 30 times a second, paused while the tab is
// hidden. With reduced motion it is one still picture.
// Decorative.
//

type RGB = [number, number, number];

// Muted, low-saturation tones.
const TONES: RGB[] = [
  [150, 108, 142], // dusty mauve
  [124, 92, 128], // plum smoke
  [112, 132, 118], // smoky sage
  [128, 136, 152], // cool slate
];

const POOLS = 5;

type Pool = {
  colour: RGB;
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

    // Every tone at least once, then the rest at random,
    // so no visit is all one colour.
    const tones = [
      ...TONES,
      ...Array.from({ length: POOLS - TONES.length }, () =>
        TONES[Math.floor(Math.random() * TONES.length)]
      ),
    ].sort(() => Math.random() - 0.5);

    const pools: Pool[] = tones.map((colour) => ({
      colour,
      x: 0.1 + Math.random() * 0.8,
      y: 0.05 + Math.random() * 0.9,
      size: 55 + Math.random() * 30,
      speed: 0.03 + Math.random() * 0.04,
      phase: Math.random() * Math.PI * 2,
      reachX: 0.12 + Math.random() * 0.18,
      reachY: 0.1 + Math.random() * 0.16,
    }));

    const nodes = pools.map((pool) => {
      const node = document.createElement("div");

      const [r, g, b] = pool.colour;

      node.style.position = "absolute";
      node.style.left = "0";
      node.style.top = "0";
      node.style.width = `${pool.size}vmax`;
      node.style.height = `${pool.size}vmax`;
      node.style.borderRadius = "50%";
      node.style.willChange = "transform";
      node.style.background = `radial-gradient(circle at center, rgba(${r}, ${g}, ${b}, 0.55) 0%, rgba(${r}, ${g}, ${b}, 0.22) 35%, rgba(${r}, ${g}, ${b}, 0) 66%)`;

      layer.appendChild(node);

      return node;
    });

    let frame = 0;
    let last = 0;

    const draw = (time: number) => {
      const t = time / 1000;

      const width = window.innerWidth;
      const height = window.innerHeight;

      const scrollable = Math.max(1, document.documentElement.scrollHeight - height);

      const progress = Math.min(1, window.scrollY / scrollable);

      pools.forEach((pool, index) => {
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

        nodes[index].style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
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

    const onScroll = () => draw(0);

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
      <div ref={layerRef} className="absolute inset-0 opacity-[0.62]" />

      {/* Black keeps the upper hand: deepest in the middle,
          where most of the copy sits. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_70%_at_50%_45%,rgba(0,0,0,0.45),rgba(0,0,0,0.2)_70%)]" />
    </div>
  );
}
