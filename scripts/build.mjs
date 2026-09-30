// Precompiles the TUI entry so the published package ships plain JS.
// JSX uses @opentui/solid's runtime (host-provided, like React's jsx-runtime),
// so the host never has to transform JSX itself (its transpiler defaults to
// React, and solid-js/web resolves to a server build under Bun).
// Solid/OpenCode imports stay external: the host provides those peers.
import { rmSync } from "node:fs";
import { build } from "esbuild";

rmSync(new URL("../dist", import.meta.url), { recursive: true, force: true });

await build({
  entryPoints: ["src/tui.tsx"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: "dist/tui.js",
  jsx: "automatic",
  jsxImportSource: "@opentui/solid",
  tsconfig: "tsconfig.build.json",
  external: ["solid-js", "@opentui/*", "@opencode/*"],
  logLevel: "warning",
});
console.log("dist/tui.js built");
