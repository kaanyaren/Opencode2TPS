import { createSignal, onCleanup, Show } from "solid-js";
import { usePlugin } from "@opencode/plugin/tui";
import { readStatus, sessionRun } from "./measure.ts";
import { subagentSegments, type Segment, type Settings } from "./options.ts";

const TICK_MS = 250;
const NAME_MAX = 22;
const MAX_ROWS = 8;
// A finished row lingers this long after its last activity, so a subagent's
// final numbers stay readable even if you don't look the moment it ends.
const KEEP_MS = 15 * 60 * 1000;

type Row = { id: string; created: number; segments: Segment[] };

function tryRead<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

function marker(running: boolean, outcome: string | undefined): string {
  if (running) return "●";
  if (outcome === "failed") return "✕";
  if (outcome === "interrupted") return "◦";
  return "✓";
}

export function sessionLabel(info: { agent?: string; title?: string }, id: string): string {
  const value = info.agent ?? info.title ?? id;
  return value.length > NAME_MAX ? `${value.slice(0, NAME_MAX - 1)}…` : value;
}

export function SubagentList(props: { sessionID: string; settings: () => Settings }) {
  const ctx = usePlugin();
  const [rows, setRows] = createSignal<Row[]>([]);

  const tick = () => {
    const nowMs = Date.now();
    const ids = tryRead<string[]>(() => ctx.data.session.family(props.sessionID), []);

    const next: Row[] = [];
    for (const id of Array.isArray(ids) ? ids : []) {
      if (id === props.sessionID) continue;
      const info = tryRead(() => ctx.data.session.get(id), undefined);
      if (!info?.parentID) continue;
      const running = readStatus(ctx, id) === "running";
      const created = info.time.created;
      // Done rows linger for KEEP_MS after their last activity; a running row
      // always shows. Older ones drop off so the list stays current.
      if (!running) {
        const lastSeen = Math.max(Number(info.time.updated) || 0, created);
        if (nowMs - lastSeen > KEEP_MS) continue;
      }
      const stats = sessionRun(ctx, id, nowMs);
      next.push({
        id,
        created,
        segments: subagentSegments(marker(running, info.outcome), sessionLabel(info, id), stats.rate, stats.genSec),
      });
    }
    next.sort((a, b) => a.created - b.created);
    setRows(next.slice(0, MAX_ROWS));
  };

  const iv = setInterval(tick, TICK_MS);
  let off: (() => void) | undefined;
  try {
    off = ctx.data.listen(() => tick());
  } catch {
    off = undefined;
  }
  onCleanup(() => {
    clearInterval(iv);
    try {
      off?.();
    } catch {
      // ignore dispose errors
    }
  });
  tick();

  // Show-evaluated so an empty list renders no element at all; a body-level
  // `return null` would run once and never react to later children.
  return (
    <Show when={rows().length > 0}>
      <box flexDirection="column" gap={0}>
        {rows().map((row) => (
          <box onMouseUp={() => ctx.ui.router.navigate({ type: "session", sessionID: row.id })}>
            <text>
              {row.segments.map((seg) =>
                seg.accent ? <span style={{ fg: props.settings().color }}>{seg.text}</span> : seg.text,
              )}
            </text>
          </box>
        ))}
      </box>
    </Show>
  );
}
