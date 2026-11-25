// Bundles the three parts of the app into dist/:
//   main.js     - Electron's main process (the agent lives here)
//   preload.js  - the narrow bridge the Code window gets
//   renderer/   - the app's own UI (React)
//
// Everything is bundled, so the packaged app needs no
// node_modules at runtime.

import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const watch = process.argv.includes("--watch");

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/renderer", { recursive: true });

const common = {
  bundle: true,
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  logLevel: "info",
};

await Promise.all([
  build({
    ...common,
    entryPoints: ["src/main/main.ts"],
    outfile: "dist/main.js",
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
  }),
  build({
    ...common,
    entryPoints: ["src/preload/preload.ts"],
    outfile: "dist/preload.js",
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
  }),
  build({
    ...common,
    entryPoints: ["src/renderer/app.tsx"],
    outfile: "dist/renderer/app.js",
    platform: "browser",
    format: "iife",
    target: "chrome130",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  }),
]);

cpSync("src/renderer/index.html", "dist/renderer/index.html");
cpSync("src/renderer/styles.css", "dist/renderer/styles.css");
cpSync("build/icon.png", "dist/icon.png");
cpSync("build/logo.png", "dist/renderer/logo.png");
