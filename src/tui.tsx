import { createSignal, createEffect, onCleanup, untrack } from "solid-js";
import { Plugin, usePlugin } from "@opencode/plugin/tui";
import { formatLine } from "./tps.ts";
import {
  readLastUser,
  readMessages,
  readStatus,
  turnMessages,
  turnRate,
  type UserLike,
} from "./measure.ts";
import { SubagentList, sessionLabel } from "./sidebar.tsx";

const TICK_MS = 100;
// A replacement user id only counts as a new turn when its prompt was
// created clearly later — same-submit sync churn shares ~one timestamp.
const MIN_SPLIT_GAP_MS = 3000;
const IDLE_LABEL = "— tps | — s";

let lastLabel: string | null = null;

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
  // Non-null while the open session is a subagent — the footer shows which.
  const [place, setPlace] = createSignal<string | null>(null);

  let turnStartedAt = 0;
  let streaming = false;
  let seenUser: UserLike | null = null;

  const show = (value: string | null) => {
    lastLabel = value;
    setLabel(value);
  };

  // Defensive: an unsynced session must never throw.
  const readPlace = (sessionID: string): string | null => {
    try {
      const info = ctx.data.session.get(sessionID);
      return info?.parentID ? sessionLabel(info, sessionID) : null;
    } catch {
      return null;
    }
  };

  const reset = () => {
    turnStartedAt = 0;
    streaming = false;
    seenUser = null;
    show(null);
    setPlace(null);
  };

  const tick = () => {
    const sessionID = props.sessionID;
    if (!sessionID) return;
    const now = Date.now();
    const status = readStatus(ctx, sessionID);
    // Read before the running guard: the badge must show while idle too.
    setPlace(readPlace(sessionID));

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
      }
      seenUser = lastUser;
    }

    if (status !== "running") return;
    if (!streaming) {
      streaming = true;
      turnStartedAt = now;
    }

    // Rate covers the whole turn: generated tokens over generation + tool-wait
    // seconds. Tool waits land when the call returns, so an MCP/shell call
    // holds the number and steps it down the moment the call finishes.
    const rate = turnRate(turnMessages(messages), now);
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

  return <text>{` ${place() ? `↳ ${place()}  ` : ""}${label() ?? IDLE_LABEL}`}</text>;
}

export default Plugin.define({
  id: "opencode2tps",
  setup(context) {
    // Prepend so the meter sits before the context/cost data in the status row.
    const offFooter = context.ui.slot({
      prepend: "prompt.footer.status",
      render: ({ sessionID }) => <TpsView sessionID={sessionID} />,
    });
    // Append below the built-in sidebar blocks; renders only with the sidebar.
    const offSidebar = context.ui.slot({
      append: "sidebar.content",
      render: ({ sessionID }) => <SubagentList sessionID={sessionID} />,
    });
    return () => {
      offFooter();
      offSidebar();
    };
  },
});
