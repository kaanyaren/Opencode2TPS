# Opencode2TPS

Live TPS meter for OpenCode2. Centered in the prompt footer status row,
with the value and `tps` label in mint green. Shows per-response speed plus
last wall time:

```text
42.1 tps | 3.2 s
```

- TPS = (output + reasoning tokens) / (generation seconds + tool-wait seconds), measured across the turn; ticking every 100ms. Right side is total turn wall time.
- Tool and MCP waits count: a call holds the number steady while it runs and steps it down the moment it returns (only completed waits are added).
- Inside a subagent's session the footer is prefixed with `↳ <agent>`, so you can tell where you are.
- While a message streams, tokens are estimated from streamed text + reasoning characters (~4.2 chars/token) and reconciled to reported usage the moment the message completes.
- `—` when the provider reports no usage and no text is visible. No persistence.
- Avg and totals intentionally removed.

## Subagent list (sidebar)

While a session spawns subagents, the sidebar shows one row per descendant
(below the built-in blocks):

```text
● explorer        124.5 tps   3.2 s
● build           98.0 tps    7.4 s
✓ merge-check     102.1 tps   1.8 s
```

- `●` running, `✓` succeeded, `✕` failed, `◦` interrupted.
- Running rows update live; finished rows freeze on the run average —
  total generated tokens / the subagent's generation seconds (tool waits excluded),
  so subagents stay comparable.
- Rows stay until you send your next prompt, then clear for the new turn.
- Click a row to open that subagent's session.
- Shows nothing when the session has no subagents.

## Install

```sh
opencode plugin add ocode2tpsmeter
```

Or declare it in config:

```jsonc
{ "plugins": ["ocode2tpsmeter"] }
```

## Dev

```sh
npm test
npm run typecheck
```
