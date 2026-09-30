import { createSignal, createEffect, onCleanup, untrack } from "solid-js";
import { Plugin, usePlugin } from "@opencode/plugin/tui";
import type { Context } from "@opencode/plugin/tui/context";
import { calcTps, formatLine } from "./tps.js";

const TICK_MS = 100;
// Single gap cap so a sleep/resume jump can't dilute the rate.
const MAX_TICK_GAP_MS = 1000;
// Rough chars-per-token for the live estimate between usage reports.
const CHARS_PER_TOKEN = 4;
// A replacement user id only counts as a new turn when its prompt was
// created clearly later — same-submit sync churn shares ~one timestamp.
const MIN_SPLIT_GAP_MS = 3000;
const IDLE_LABEL = "— tps | — s";

let lastLabel: string | null = null;

// Output tokens only: input grows with context and cache figures are a
// subset of input, so only output measures generation speed.
function readOutputTokens(ctx: Context, sessionID: string): number | null {
  try {
    const output = ctx.data.session.get(sessionID)?.tokens?.output;
    if (typeof output === "number") return output;
  } catch {
    // Fall through to the per-message sum below.
  }
  try {
    const messages = ctx.data.session.message.list(sessionID) ?? [];
    let sum = 0;
    let found = false;
    for (const m of messages) {
      const output = (m as { tokens?: { output?: unknown } }).tokens?.output;
      if (typeof output === "number") {
        sum += output;
        found = true;
      }
    }
    return found ? sum : null;
  } catch {
    return null;
  }
}

// Total streamed assistant text length. Unlike token usage (reported per
// completed message), text grows live, so it drives the estimate between
// reports. Returns null when the list is unreadable.
function readTextChars(ctx: Context, sessionID: string): number | null {
  try {
    const messages = ctx.data.session.message.list(sessionID);
    if (!Array.isArray(messages)) return null;
    let sum = 0;
    for (const m of messages) {
      const mm = m as { type?: unknown; content?: unknown };
      if (mm?.type !== "assistant" || !Array.isArray(mm.content)) continue;
      for (const part of mm.content) {
        const p = part as { type?: unknown; text?: unknown };
        if (p?.type === "text" && typeof p.text === "string") sum += p.text.length;
      }
    }
    return sum;
  } catch {
    return null;
  }
}

type LastUser = { id: string; created: number };
function readLastUser(ctx: Context, sessionID: string): LastUser | null {
  try {
    const messages = ctx.data.session.message.list(sessionID);
    if (!Array.isArray(messages)) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i] as { type?: unknown; id?: unknown; time?: { created?: unknown } };
      if (m?.type === "user" && typeof m.id === "string") {
        const created = m.time?.created;
        return { id: m.id, created: typeof created === "number" ? created : 0 };
      }
    }
    return null;
  } catch {
    return null;
  }
}
function readStatus(ctx: Context, sessionID: string): "idle" | "running" {
  try {
    return ctx.data.session.status(sessionID);
  } catch {
    return "idle";
  }
}

function TpsView(props: { sessionID?: string }) {
  const ctx = usePlugin();
  ctx.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "opencode2tps.status",
        title: "Opencode2TPS: Show current TPS",
        group: "Opencode2TPS",
        palette: true,
        run: () =>
          ctx.ui.toast.show({
            message: lastLabel ?? IDLE_LABEL,
            variant: "info",
            duration: 5000,
          }),
      },
    ],
  }));
  const [label, setLabel] = createSignal<string | null>(null);

  let baseOutput = 0;
  let baseAt = 0;
  let activeMs = 0;
  let lastTickAt = 0;
  let streaming = false;
  let seenUser: LastUser | null = null;
  let repCur: number | null = null;
  let turnStartChars: number | null = null;
  let charsAtRep: number | null = null;

  const show = (value: string | null) => {
    lastLabel = value;
    setLabel(value);
  };

  const reset = () => {
    baseOutput = 0;
    baseAt = 0;
    activeMs = 0;
    lastTickAt = 0;
    streaming = false;
    seenUser = null;
    repCur = null;
    turnStartChars = null;
    charsAtRep = null;
    show(null);
  };

  const tick = () => {
    const sessionID = props.sessionID;
    if (!sessionID) return;
    const now = Date.now();
    const status = readStatus(ctx, sessionID);
    const cur = readOutputTokens(ctx, sessionID);
    const chars = readTextChars(ctx, sessionID);

    // A new turn starts when a genuinely new user prompt appears. Two guards
    // against mid-turn message churn (sync replacements share ~the same
    // created timestamp; churn while running is ignored outright): only
    // split while idle, and only when the new prompt is clearly newer.
    // Idle alone never ends the turn — the display just freezes.
    const lastUser = readLastUser(ctx, sessionID);
    if (lastUser && !seenUser) {
      seenUser = lastUser;
    } else if (lastUser && seenUser && lastUser.id !== seenUser.id && status !== "running") {
      if (lastUser.created - seenUser.created > MIN_SPLIT_GAP_MS) {
        streaming = false;
      }
      seenUser = lastUser;
    }

    if (status === "running") {
      if (!streaming) {
        streaming = true;
        baseAt = now;
        baseOutput = cur ?? 0;
        repCur = cur;
        turnStartChars = chars;
        charsAtRep = chars;
        activeMs = 0;
      } else {
        // Count only time spent generating: idle gaps (tool calls, waits)
        // freeze the display and must not dilute the rate.
        activeMs += Math.min(MAX_TICK_GAP_MS, Math.max(0, now - lastTickAt));
        if (cur !== null && cur !== repCur) {
          repCur = cur;
          charsAtRep = chars;
        }
      }
      // Reported usage lands per completed message; between reports, estimate
      // the streaming tail from text growth so the meter stays live instead
      // of dwelling at zero and spiking at completion.
      let delta: number | null;
      if (repCur === null) {
        delta =
          chars !== null && turnStartChars !== null
            ? Math.max(0, chars - turnStartChars) / CHARS_PER_TOKEN
            : null;
      } else {
        const tail =
          chars !== null && charsAtRep !== null
            ? Math.max(0, chars - charsAtRep) / CHARS_PER_TOKEN
            : 0;
        delta = Math.max(0, repCur - baseOutput) + tail;
      }
      const wallSec = (now - baseAt) / 1000;
      show(formatLine(delta === null ? null : calcTps(delta, activeMs / 1000), wallSec));
    }
    lastTickAt = now;
  };

  createEffect(() => {
    void props.sessionID;
    reset();
    // untrack: tick() reads the reactive data store, and those reads must
    // not subscribe this effect — otherwise every store update (tool call,
    // token update) re-runs reset() and restarts the timer/baseline.
    untrack(() => tick());
  });

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

  return <text>{label() ?? IDLE_LABEL}</text>;
}

export default Plugin.define({
  id: "opencode2tps",
  setup(context) {
    // Prepend so the meter sits before the context/cost data in the status row.
    const off = context.ui.slot({
      prepend: "prompt.footer.status",
      render: ({ sessionID }) => <TpsView sessionID={sessionID} />,
    });
    return () => off();
  },
});
