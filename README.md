# Opencode2TPS

Live TPS meter for OpenCode2. **Centered** in the prompt footer status row
(configurable position), with the TPS value and `tps` label in mint green
(configurable) and a width-aware layout:

```text
42.1 tps | 3.2 s
```

- TPS = (output + reasoning tokens) / (generation seconds + tool-wait seconds), measured across the turn; ticking every 100ms. Right side is total turn wall time.
- Tool and MCP waits count: a call holds the number steady while it runs and steps it down the moment it returns (only completed waits are added).
- Width-aware: full `42.1 tps | 3.2 s` at wide terminals, just the number (`42.1`) when narrow, hidden on very narrow rows (<44 cols). The timer segment can be hidden with `showTimer`.
- Type `/tps` (or run `Opencode2TPS: Settings` from the command palette) to configure position, colour, compact mode, the sidebar, and the timer.
- Can show a small speed bar (at most 12 columns, drawn in the same colour as the TPS value) that scales against the session's observed max TPS; toggle with `showBar` in `/tps`.
- Inside a subagent's session the footer is prefixed with `↳ <agent>`, so you can tell where you are.
- While a message streams, tokens are estimated from streamed text + reasoning characters (~4.2 chars/token) and reconciled to reported usage the moment the message completes.
- `—` when the provider reports no usage and no text is visible. No persistence.
- Run `Opencode2TPS: Show current TPS` from the command palette for a breakdown: turn tps, generation-only tps, tool-wait seconds, wall seconds, and generation tokens (input/cache excluded).
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
  total generated tokens over the subagent's generation seconds plus completed
  tool waits, using the same definition as the footer, so the row and footer
  never disagree.
- Rows stay until you send your next prompt, then clear for the new turn.
- Click a row to open that subagent's session.
- Shows nothing when the session has no subagents.

## Settings

Type `/tps` in the prompt (or run `Opencode2TPS: Settings` from the command palette)
to open the settings menu.

| Setting | Values | Default | Notes |
| --- | --- | --- | --- |
| `position` | center / left / right | center | Where the meter sits in the footer row. |
| `color` | hex string | `#6ee7b7` | Colour of the TPS value and `tps` label. |
| `compact` | on / off | off | When on, show just the number, e.g. `42.1`. |
| `showSidebar` | on / off | on | Show the subagent list in the sidebar. |
| `showTimer` | on / off | on | Show the ` | 3.2 s` wall-time segment. |
| `showBar` | on / off | on | Show a fixed 8-cell speed bar (`████░░░░`); zero tps is a fully empty bar, the session's observed maximum is a full bar. Drawn in the configured `color`. |

Settings persist across TUI restarts and sync across running TUI instances;
"Reset to defaults" clears them.

## Install

```sh
opencode plugin add ocode2tpsmeter
```

Or declare it in config:

```jsonc
{ "plugins": ["ocode2tpsmeter"] }
```

### Force update

OpenCode caches resolved npm plugins under
`~/.cache/opencode/npm/ocode2tpsmeter@latest/`. After a new release, clear
that directory (or pin a version, e.g. `"ocode2tpsmeter@0.2.6"`) and restart
the TUI.

## Dev

```sh
npm test
npm run typecheck
```
