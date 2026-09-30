# Opencode2TPS

Live TPS meter for OpenCode2. Right-aligned in the prompt footer status row,
before the context/cost data. Shows per-response speed plus last wall time:

```text
42.1 tps | 3.2 s
```

- TPS = (output + reasoning tokens) / that message's generation seconds, measured per assistant message; ticking every 100ms. Right side is total turn wall time.
- While a message streams, tokens are estimated from streamed text + reasoning characters (~4.2 chars/token) and reconciled to reported usage the moment the message completes.
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
