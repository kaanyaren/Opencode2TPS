// Precompiles the TUI entry so the published package ships plain JS.
// JSX compiles to @opentui/solid primitives (the working ecosystem pattern):
// the host provides @opentui/solid, solid-js and @opencode/plugin/tui, so
// the bundle must NOT resolve them from its own node_modules — foreign
// reactive instances render once and never update.
import { rmSync } from "node:fs";
import { build } from "esbuild";
import { solidPlugin } from "esbuild-plugin-solid";

rmSync(new URL("../dist", import.meta.url), { recursive: true, force: true });

await build({
  entryPoints: ["src/tui.tsx"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: "dist/tui.js",
  external: ["solid-js", "@opentui/*", "@opencode/*"],
  plugins: [solidPlugin({ solid: { moduleName: "@opentui/solid", generate: "universal" } })],
  logLevel: "warning",
});
console.log("dist/tui.js built");
