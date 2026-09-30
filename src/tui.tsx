import { createSignal, createEffect, onCleanup, untrack } from "solid-js";
import { Plugin, usePlugin } from "@opencode/plugin/tui";
import type { Context } from "@opencode/plugin/tui/context";
import { calcTps, formatLine } from "./tps.js";

const TICK_MS = 100;
// Chars-per-token for the live estimate between usage reports. Measured on
// real traffic: text ~4.7, reasoning ~4.0.
const CHARS_PER_TOKEN = 4.2;
// A replacement user id only counts as a new turn when its prompt was
// created clearly later — same-submit sync churn shares ~one timestamp.
const MIN_SPLIT_GAP_MS = 3000;
const IDLE_LABEL = "— tps | — s";

let lastLabel: string | null = null;

type MsgLike = {
  id?: unknown;
  type?: unknown;
  time?: { created?: unknown; completed?: unknown };
  tokens?: { output?: unknown; reasoning?: unknown };
  content?: unknown;
};

type LastUser = { id: string; created: number };

function readMessages(ctx: Context, sessionID: string): MsgLike[] {
  try {
    const messages = ctx.data.session.message.list(sessionID);
    return Array.isArray(messages) ? (messages as MsgLike[]) : [];
  } catch {
    return [];
  }
}

function readLastAssistant(messages: MsgLike[]): MsgLike | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.type === "assistant") return messages[i];
  }
  return null;
}

function readLastUser(messages: MsgLike[]): LastUser | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.type === "user" && typeof m.id === "string") {
      const created = m.time?.created;
      return { id: m.id, created: typeof created === "number" ? created : 0 };
    }
  }
  return null;
}

// Streamed text + reasoning characters of one message. Both are generated
// tokens; counting only visible text reads ~0 while the model thinks.
function charsOf(msg: MsgLike): number {
  if (!Array.isArray(msg.content)) return 0;
  let sum = 0;
  for (const part of msg.content) {
    const p = part as { type?: unknown; text?: unknown };
    if ((p?.type === "text" || p?.type === "reasoning") && typeof p.text === "string") {
      sum += p.text.length;
    }
  }
  return sum;
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

  let turnStartedAt = 0;
  let streaming = false;
  let seenUser: LastUser | null = null;
  let currentMsgID: unknown = null;
  let frozenRate: number | null = null;

  const show = (value: string | null) => {
    lastLabel = value;
    setLabel(value);
  };

  const reset = () => {
    turnStartedAt = 0;
    streaming = false;
    seenUser = null;
    currentMsgID = null;
    frozenRate = null;
    show(null);
  };

  const tick = () => {
    const sessionID = props.sessionID;
    if (!sessionID) return;
    const now = Date.now();
    const status = readStatus(ctx, sessionID);

    // A new turn starts when a genuinely new user prompt appears. Two guards
    // against mid-turn message churn (sync replacements share ~the same
    // created timestamp; churn while running is ignored outright): only
    // split while idle, and only when the new prompt is clearly newer.
    // Idle alone never ends the turn — the display just freezes.
    const messages = readMessages(ctx, sessionID);
    const lastUser = readLastUser(messages);
    if (lastUser && !seenUser) {
      seenUser = lastUser;
    } else if (lastUser && seenUser && lastUser.id !== seenUser.id && status !== "running") {
      if (lastUser.created - seenUser.created > MIN_SPLIT_GAP_MS) {
        streaming = false;
        frozenRate = null;
      }
      seenUser = lastUser;
    }

    if (status !== "running") return;
    if (!streaming) {
      streaming = true;
      turnStartedAt = now;
    }

    // Rate is measured per assistant message: reported (output + reasoning)
    // over the message lifetime — the part that is actually generation.
    // Turn "running" time also covers prefill, queueing and approvals, so
    // dividing by it under-reports badly (measured ~76 vs ~133 tps).
    const msg = readLastAssistant(messages);
    let rate = frozenRate;
    if (msg) {
      if (msg.id !== currentMsgID) currentMsgID = msg.id;
      const created = msg.time?.created;
      const completed = msg.time?.completed;
      const out = msg.tokens?.output;
      const reasoning = msg.tokens?.reasoning;
      if (
        typeof created === "number" &&
        typeof completed === "number" &&
        typeof out === "number"
      ) {
        // Completed step: exact.
        const span = Math.max(0.2, (completed - created) / 1000);
        const tokens = out + (typeof reasoning === "number" ? reasoning : 0);
        frozenRate = calcTps(tokens, span);
        rate = frozenRate;
      } else if (typeof created === "number") {
        // In flight: estimate from streamed characters. Reported usage lands
        // only when the message completes, so without this the meter dwells
        // near zero and spikes at the end.
        const chars = charsOf(msg);
        if (chars > 0) {
          const elapsed = Math.max(0.3, (now - created) / 1000);
          rate = calcTps(chars / CHARS_PER_TOKEN, elapsed);
        }
      }
    }

    const wallSec = (now - turnStartedAt) / 1000;
    show(formatLine(rate, wallSec));
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
