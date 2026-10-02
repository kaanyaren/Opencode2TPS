import { createSignal, createEffect, onCleanup, untrack, Show } from "solid-js";
import { Plugin, usePlugin } from "@opencode/plugin/tui";
import { useTerminalDimensions } from "@opentui/solid";
import {
  readLastUser,
  readMessages,
  readStatus,
  turnMessages,
  turnRate,
  aggregate,
  toolSec,
  type UserLike,
} from "./measure.ts";
import {
  normalizeOptions,
  meterTier,
  justifyFor,
  meterSegments,
  type MeterOptions,
} from "./options.ts";
import { SubagentList, sessionLabel } from "./sidebar.tsx";

const TICK_MS = 100;
// A replacement user id only counts as a new turn when its prompt was
// created clearly later — same-submit sync churn shares ~one timestamp.
const MIN_SPLIT_GAP_MS = 3000;
const IDLE_LABEL = "— tps | — s";

type Line = { tps: number | null; elapsed: number };

// Palette toast detail, filled while running; the run callback stays reactive
// to this without needing a signal.
let lastDetail: string | null = null;

function TpsView(props: { sessionID?: string; options: MeterOptions }) {
  const ctx = usePlugin();
  const term = useTerminalDimensions();
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
            message: lastDetail ?? IDLE_LABEL,
            variant: "info",
            duration: 5000,
          }),
      },
    ],
  }));
  const [line, setLine] = createSignal<Line | null>(null);
  // Non-null while the open session is a subagent — the footer shows which.
  const [place, setPlace] = createSignal<string | null>(null);

  let turnStartedAt = 0;
  let streaming = false;
  let seenUser: UserLike | null = null;
  // 100ms polling only runs while the session is generating; idle sessions do
  // nothing until `ctx.data.listen` wakes us on a store change.
  let iv: ReturnType<typeof setInterval> | undefined;

  const show = (value: Line | null) => {
    setLine(value);
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
    if (!sessionID) {
      ensureInterval(false);
      return;
    }
    const now = Date.now();
    const status = readStatus(ctx, sessionID);
    ensureInterval(status === "running");
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
    const turn = turnMessages(messages);
    const rate = turnRate(turn, now);
    const wallSec = (now - turnStartedAt) / 1000;
    const gen = aggregate(
      turn.filter((msg) => msg.type === "assistant"),
      now,
    );
    const fmtRate = (value: number | null) => (value === null ? "—" : value.toFixed(1));
    // Surfaced by the palette command; breaks out what the single meter number
    // blends together (turn rate includes tool waits; gen-only excludes them).
    lastDetail =
      `${fmtRate(rate)} tps | gen ${fmtRate(gen.avgRate)} tps | ` +
      `tool ${toolSec(turn).toFixed(1)}s | ${wallSec.toFixed(1)}s wall | ` +
      `${gen.tokens} tok (output+reasoning; input/cache excluded)`;
    show({ tps: rate, elapsed: wallSec });
  };

  const ensureInterval = (running: boolean) => {
    if (running && iv === undefined) {
      iv = setInterval(tick, TICK_MS);
    } else if (!running && iv !== undefined) {
      clearInterval(iv);
      iv = undefined;
    }
  };

  createEffect(() => {
    void props.sessionID;
    reset();
    // untrack: tick() reads the reactive data store, and those reads must
    // not subscribe this effect — otherwise every store update (tool call,
    // token update) re-runs reset() and restarts the timer/baseline.
    untrack(() => tick());
  });

  let off: (() => void) | undefined;
  try {
    off = ctx.data.listen(() => tick());
  } catch {
    off = undefined;
  }
  onCleanup(() => {
    if (iv !== undefined) clearInterval(iv);
    try {
      off?.();
    } catch {
      // ignore dispose errors
    }
  });
  tick();

  // Width picks the tier; compact hides the labels, too narrow hides the
  // whole meter so it never fights the built-in footer text for space.
  const tier = () => meterTier(term().width, props.options.compact);
  const visible = () => line() !== null && tier() !== "hidden";
  const segments = () => {
    const value = line();
    return value ? meterSegments(value.tps, value.elapsed, tier()) : [];
  };

  // Absolutely positioned so it centres across the whole footer row instead of
  // competing with the built-in status text for flex space. The inner box is
  // content-width so its background only masks the built-in text where the
  // meter actually sits.
  return (
    <Show when={visible()}>
      <box
        position="absolute"
        left={0}
        right={0}
        zIndex={1}
        flexDirection="row"
        justifyContent={justifyFor(props.options.position)}
        flexShrink={0}
      >
        <box
          backgroundColor={ctx.theme.background.base}
          paddingLeft={1}
          paddingRight={1}
        >
          <text wrapMode="none">
            {place() ? <span>{`↳ ${place()}  `}</span> : null}
            {segments().map((seg) =>
              seg.accent ? (
                <span style={{ fg: props.options.color }}>{seg.text}</span>
              ) : (
                seg.text
              ),
            )}
          </text>
        </box>
      </box>
    </Show>
  );
}

export default Plugin.define({
  id: "opencode2tps",
  setup(context) {
    const { options, invalid } = normalizeOptions(context.options);
    if (invalid.length > 0) {
      context.ui.toast.show({
        title: "Opencode2TPS",
        message: `ignoring invalid option(s): ${invalid.join(", ")}`,
        variant: "warning",
        duration: 5000,
      });
    }
    // Sibling of the built-in status, absolutely positioned to centre across
    // the whole footer row.
    const offFooter = context.ui.slot({
      after: "prompt.footer.status",
      render: ({ sessionID }) => <TpsView sessionID={sessionID} options={options} />,
    });
    // Append below the built-in sidebar blocks; renders only with the sidebar.
    const offSidebar = context.ui.slot({
      append: "sidebar.content",
      render: ({ sessionID }) => <SubagentList sessionID={sessionID} options={options} />,
    });
    return () => {
      offFooter();
      offSidebar();
    };
  },
});
