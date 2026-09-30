// Precompiles the TUI entry so the published package ships plain JS.
// The host must not have to transform JSX (its transpiler defaults to React).
// Solid/OpenCode imports stay external: the host provides those peers.
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
  jsx: "automatic",
  external: ["solid-js", "@opentui/*", "@opencode/*"],
  plugins: [solidPlugin()],
  logLevel: "warning",
});
console.log("dist/tui.js built");
