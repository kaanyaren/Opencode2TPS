# Opencode2TPS

Live TPS meter for OpenCode2. Right-aligned in the prompt footer status row,
before the context/cost data. Shows per-response speed plus last wall time:

```text
42.1 t/s | 3.2 s
```

- TPS = (input + output tokens) / response wall seconds, ticking every 100ms.
- `—` when the provider reports no usage. No estimation, no persistence.
- Avg and totals intentionally removed.

## Install

```json
{ "plugin": ["opencode2tps"] }
```

## Dev

```sh
npm test
npm run typecheck
```
