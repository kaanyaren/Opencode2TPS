# Opencode2TPS

Live TPS meter for OpenCode2. Right-aligned in the prompt footer status row,
before the context/cost data. Shows per-response speed plus last wall time:

```text
42.1 tps | 3.2 s
```

- TPS = output tokens / active streaming seconds (tool waits excluded), ticking every 100ms. Right side is total turn wall time.
- Reported usage lands per completed message; between reports the streaming tail is estimated from text growth (~4 chars/token) and reconciled to reported totals on completion.
- `—` when the provider reports no usage and no text is visible. No persistence.
- Avg and totals intentionally removed.

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
