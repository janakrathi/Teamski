"use client";

import { useEffect, useRef } from "react";

import BrandIcon from "@/components/ui/BrandIcon";


// ==========================================
// THE CONNECTIONS, IN ORBIT
// ==========================================
//
// A slowly turning network - the agents and what they
// know - with the apps they connect to circling it on
// two tilted rings. Drawn on a canvas, with the app
// badges as ordinary elements on top so they keep their
// real icons and text.
//
// Kept cheap: a fixed, seeded set of points (the same
// picture every visit), nothing runs while the section
// is off screen or the tab is hidden, and anyone who
// asked their system for less motion gets a still frame.
//

type App = { id: string; name: string };

const POINTS = 150;
const NEIGHBOURS = 3;

// One full turn of the network, and of an app round
// its ring, in milliseconds.
const SPIN_MS = 60_000;
const ORBIT_MS = 180_000;

const TILT = -0.3;

const SHORT_NAMES: Record<string, string> = {
  atlassian: "Jira",
  huggingface: "Hugging Face",
};


// A small seeded random, so the network is the same
// shape on every load and between server and browser.
function seeded(seed: number) {
  let state = seed;

  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;

    return state / 4294967296;
  };
}


function buildNetwork() {
  const random = seeded(7);
  const xs = new Float32Array(POINTS);
  const ys = new Float32Array(POINTS);
  const zs = new Float32Array(POINTS);
  const sizes = new Float32Array(POINTS);

  // Points spread evenly over a sphere, then pulled in a
  // little at random so it reads as a cluster, not a ball.
  const golden = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < POINTS; i++) {
    const y = 1 - (i / (POINTS - 1)) * 2;
    const ring = Math.sqrt(1 - y * y);
    const theta = golden * i;
    const pull = 0.72 + random() * 0.28;

    xs[i] = Math.cos(theta) * ring * pull;
    ys[i] = y * pull;
    zs[i] = Math.sin(theta) * ring * pull;
    sizes[i] = random() < 0.12 ? 2.6 + random() * 1.4 : 1.1 + random() * 1.1;
  }

  // Each point joins its nearest few; pairs are kept once.
  const seen = new Set<string>();
  const edges: [number, number][] = [];

  for (let i = 0; i < POINTS; i++) {
    const nearest: { j: number; d: number }[] = [];

    for (let j = 0; j < POINTS; j++) {
      if (i === j) continue;

      const d =
        (xs[i] - xs[j]) ** 2 + (ys[i] - ys[j]) ** 2 + (zs[i] - zs[j]) ** 2;

      nearest.push({ j, d });
    }

    nearest.sort((a, b) => a.d - b.d);

    for (const { j } of nearest.slice(0, NEIGHBOURS)) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;

      if (!seen.has(key)) {
        seen.add(key);
        edges.push([i, j]);
      }
    }
  }

  return { xs, ys, zs, sizes, edges };
}


function rgbOf(value: string, fallback: [number, number, number]) {
  const hex = value.trim().replace("#", "");

  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ] as [number, number, number];
  }

  return fallback;
}


export default function ConnectionsOrbit({ apps }: { apps: App[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const badgeRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!wrap || !canvas || !context) {
      return;
    }

    const network = buildNetwork();
    const count = network.xs.length;
    const px = new Float32Array(count);
    const py = new Float32Array(count);
    const depth = new Float32Array(count);

    const styles = getComputedStyle(document.documentElement);
    const [tr, tg, tb] = rgbOf(styles.getPropertyValue("--text"), [232, 230, 227]);
    const [ar, ag, ab] = rgbOf(styles.getPropertyValue("--accent"), [201, 100, 66]);

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let frame = 0;
    let onScreen = true;

    // Half of each badge's width, measured on first use.
    const halves: number[] = [];

    function resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);

      width = wrap!.clientWidth;
      height = wrap!.clientHeight;
      canvas!.width = Math.round(width * ratio);
      canvas!.height = Math.round(height * ratio);
      context!.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function draw(time: number) {
      const cx = width / 2;
      const cy = height / 2;
      const narrow = width < 640;

      const radius = Math.min(width * (narrow ? 0.3 : 0.24), height * 0.36);

      const rings = [
        { rx: width * (narrow ? 0.44 : 0.45), ry: height * 0.3 },
        { rx: width * (narrow ? 0.33 : 0.34), ry: height * 0.2 },
      ];

      context!.clearRect(0, 0, width, height);

      // The rings.
      context!.lineWidth = 1;
      context!.strokeStyle = `rgba(${tr},${tg},${tb},0.07)`;

      for (const ring of rings) {
        context!.beginPath();
        context!.ellipse(cx, cy, ring.rx, ring.ry, 0, 0, Math.PI * 2);
        context!.stroke();
      }

      // The network, turned and tilted, in perspective.
      const turn = (time / SPIN_MS) * Math.PI * 2;
      const cosY = Math.cos(turn);
      const sinY = Math.sin(turn);
      const cosX = Math.cos(TILT);
      const sinX = Math.sin(TILT);
      const focal = 3.5;

      for (let i = 0; i < count; i++) {
        const x1 = network.xs[i] * cosY - network.zs[i] * sinY;
        const z1 = network.xs[i] * sinY + network.zs[i] * cosY;
        const y2 = network.ys[i] * cosX - z1 * sinX;
        const z2 = network.ys[i] * sinX + z1 * cosX;
        const scale = focal / (focal - z2);

        px[i] = cx + x1 * radius * scale;
        py[i] = cy + y2 * radius * scale;
        depth[i] = (z2 + 1) / 2;
      }

      for (const [i, j] of network.edges) {
        const alpha = 0.05 + 0.24 * ((depth[i] + depth[j]) / 2);

        context!.strokeStyle = `rgba(${tr},${tg},${tb},${alpha.toFixed(3)})`;
        context!.beginPath();
        context!.moveTo(px[i], py[i]);
        context!.lineTo(px[j], py[j]);
        context!.stroke();
      }

      for (let i = 0; i < count; i++) {
        const alpha = 0.3 + 0.62 * depth[i];
        const size = network.sizes[i] * (0.6 + 0.7 * depth[i]);

        context!.fillStyle = `rgba(${tr},${tg},${tb},${alpha.toFixed(3)})`;
        context!.beginPath();
        context!.arc(px[i], py[i], size, 0, Math.PI * 2);
        context!.fill();
      }

      // A few sparks travelling the rings.
      context!.fillStyle = `rgba(${ar},${ag},${ab},0.9)`;

      for (let k = 0; k < 3; k++) {
        const ring = rings[k % 2];
        const angle = (time / (ORBIT_MS / 3)) * Math.PI * 2 * (k % 2 ? -1 : 1) + k * 2.1;

        context!.beginPath();
        context!.arc(
          cx + ring.rx * Math.cos(angle),
          cy + ring.ry * Math.sin(angle),
          1.8,
          0,
          Math.PI * 2
        );
        context!.fill();
      }

      // The apps, spaced round the two rings. Ones passing
      // behind the network fade so it reads as depth.
      const shown = narrow ? Math.min(apps.length, 6) : apps.length;

      badgeRefs.current.forEach((badge, k) => {
        if (!badge) return;

        if (k >= shown) {
          badge.style.opacity = "0";
          return;
        }

        const ring = rings[k % 2];
        const perRing = Math.ceil(shown / 2);
        const slot = Math.floor(k / 2);
        const angle =
          (time / ORBIT_MS) * Math.PI * 2 +
          (slot / perRing) * Math.PI * 2 +
          (k % 2) * (Math.PI / perRing);

        // Held inside the frame, so a long label at the
        // far end of a ring is never cut off. Measured
        // once; a badge does not change size.
        halves[k] ??= badge.offsetWidth / 2;

        const x = Math.min(
          Math.max(cx + ring.rx * Math.cos(angle), halves[k] + 4),
          width - halves[k] - 4
        );
        const y = cy + ring.ry * Math.sin(angle);
        const front = Math.sin(angle);
        const hidden = front < 0 && Math.abs(x - cx) < radius * 1.05;

        badge.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
        badge.style.opacity = hidden ? "0.28" : (0.6 + 0.4 * ((front + 1) / 2)).toFixed(2);
      });
    }

    // 30 frames a second is smooth for a slow orbit, and
    // leaves the rest of the page room to scroll.
    let last = 0;

    function loop(time: number) {
      frame = requestAnimationFrame(loop);

      if (time - last < 33) {
        return;
      }

      last = time;

      draw(time);
    }

    function start() {
      if (still || frame || !onScreen || document.visibilityState !== "visible") {
        return;
      }

      frame = requestAnimationFrame(loop);
    }

    function stop() {
      cancelAnimationFrame(frame);
      frame = 0;
    }

    resize();
    draw(still ? 12_000 : performance.now());

    const sizes = new ResizeObserver(() => {
      resize();
      draw(still ? 12_000 : performance.now());
    });

    sizes.observe(wrap);

    const visible = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;

      if (onScreen) start();
      else stop();
    });

    visible.observe(wrap);

    function onVisibility() {
      if (document.visibilityState === "visible") start();
      else stop();
    }

    document.addEventListener("visibilitychange", onVisibility);

    start();

    return () => {
      stop();
      sizes.disconnect();
      visible.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [apps.length]);

  return (
    <div
      ref={wrapRef}
      role="img"
      aria-label={`Teamski's agents connect to ${apps.map((app) => app.name).join(", ")}.`}
      className="relative mt-10 h-[340px] w-full overflow-hidden sm:h-[440px] lg:h-[480px]"
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
      />

      {apps.map((app, k) => (
        <div
          key={app.id}
          ref={(node) => {
            badgeRefs.current[k] = node;
          }}
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-0 flex flex-col items-center gap-1.5 opacity-0"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-strong)] bg-[var(--bg)]">
            <BrandIcon id={app.id} className="h-4 w-4 text-[var(--text-muted)]" />
          </span>

          <span className="font-mono text-[10px] tracking-[0.18em] whitespace-nowrap text-[var(--text-faint)] uppercase">
            {SHORT_NAMES[app.id] ?? app.name}
          </span>
        </div>
      ))}
    </div>
  );
}
