import { createSignal, createEffect, onCleanup, untrack, Show, type Accessor } from "solid-js";
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
  mergeSettings,
  meterTier,
  justifyFor,
  meterSegments,
  speedBar,
  observedMax,
  isValidColor,
  clampGap,
  DEFAULT_SETTINGS,
  type Settings,
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

// The menu builds a fresh loop each time it opens; the loop returns "exit" to
// stop, or the id of the setting to edit next. Defensive furniture lives in
// the run callback so a dialog error can never crash the TUI.
type MenuChoice =
  | "position"
  | "color"
  | "gap"
  | "compact"
  | "sidebar"
  | "timer"
  | "bar"
  | "reset"
  | "exit";

function TpsView(props: {
  sessionID?: string;
  settings: Accessor<Settings>;
  update: (mutation: (draft: Settings) => void) => Promise<void>;
}) {
  const ctx = usePlugin();
  const term = useTerminalDimensions();
  const settings = () => props.settings();
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
      {
        id: "opencode2tps.settings",
        title: "Opencode2TPS: Settings",
        group: "Opencode2TPS",
        palette: true,
        slash: { name: "tps" },
        // async so the dialog awaits resolve; wired through ctx so it needs no
        // other file. The loop lets the user change several settings in one go.
        run: async () => {
          try {
            await settingsMenu(ctx, props);
          } catch (error) {
            ctx.ui.toast.show({
              variant: "error",
              title: "Opencode2TPS",
              message: `settings failed: ${String(error)}`,
              duration: 5000,
            });
          }
        },
      },
    ],
  }));
  const [line, setLine] = createSignal<Line | null>(null);
  // Non-null while the open session is a subagent — the footer shows which.
  const [place, setPlace] = createSignal<string | null>(null);

  let turnStartedAt = 0;
  // Full scale of the speed bar: the highest turn rate seen this session.
  let sessionMax = 0;
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
    sessionMax = 0;
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
    // The bar's scale only grows, so it never jitters as the rate dips.
    sessionMax = observedMax(rate, sessionMax, 0);
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
  // whole meter so it never fights the built-in footer text for space. Only the
  // center position draws on top of the built-in row; left/right keep to the
  // edges the host leaves empty, so they never cover the status/progress text.
  const tier = () => meterTier(term().width, settings().compact);
  const visible = () => line() !== null && tier() !== "hidden";
  // Pre-rendered and unaccented: an empty string means no bar segment at all.
  const bar = () => {
    const value = line();
    const s = props.settings();
    if (!value || !s.showBar) return "";
    return speedBar(value.tps, sessionMax);
  };
  const segments = () => {
    const value = line();
    return value ? meterSegments(value.tps, value.elapsed, tier(), settings().showTimer, bar()) : [];
  };

  // Center draws across the whole footer row (absolutely positioned so it
  // doesn't compete with the built-in status text for flex space) and masks
  // what it covers. Left/right instead sit in the row's natural flow, at the
  // edges the host leaves empty, so the status/progress text is never covered.
  // gap pads the meter symmetrically either way.
  const pad = () => clampGap(settings().gap);
  const content = () => (
    <text wrapMode="none">
      {place() ? <span>{`↳ ${place()}  `}</span> : null}
      {segments().map((seg) =>
        seg.accent ? <span style={{ fg: settings().color }}>{seg.text}</span> : seg.text,
      )}
    </text>
  );

  return (
    <Show when={visible()}>
      <Show
        when={settings().position === "center"}
        fallback={
          <box flexShrink={0} paddingLeft={pad()} paddingRight={pad()} backgroundColor={ctx.theme.background.base}>
            {content()}
          </box>
        }
      >
        <box
          position="absolute"
          left={0}
          right={0}
          zIndex={1}
          flexDirection="row"
          justifyContent={justifyFor(settings().position)}
          flexShrink={0}
        >
          <box backgroundColor={ctx.theme.background.base} paddingLeft={pad()} paddingRight={pad()}>
            {content()}
          </box>
        </box>
      </Show>
    </Show>
  );
}

// One round of the settings menu. Returns the next choice to edit, or null to
// close. Live text is re-read from the accessor so a cancelled colour prompt
// keeps whatever the user had.
async function settingsMenu(
  ctx: ReturnType<typeof usePlugin>,
  props: { settings: Accessor<Settings>; update: (mutation: (draft: Settings) => void) => Promise<void> },
): Promise<void> {
  let choice: MenuChoice = "position";
  while (choice !== "exit") {
    const current = props.settings();
    const next = await ctx.ui.dialog.select<MenuChoice>({
      title: "Opencode2TPS settings",
      placeholder: "Pick a setting…",
      options: [
        { title: "Position", value: "position", description: current.position },
        { title: "Color", value: "color", description: current.color },
        { title: "Gap", value: "gap", description: String(current.gap) },
        { title: "Compact", value: "compact", description: current.compact ? "on" : "off" },
        { title: "Show sidebar", value: "sidebar", description: current.showSidebar ? "on" : "off" },
        { title: "Show timer", value: "timer", description: current.showTimer ? "on" : "off" },
        { title: "Speed bar", value: "bar", description: current.showBar ? "on" : "off" },
        { title: "Reset to defaults", value: "reset" },
        { title: "Done", value: "exit" },
      ],
    });
    if (next === undefined) return;

    if (next === "position") {
      const value = await ctx.ui.dialog.select<Settings["position"]>({
        title: "TPS meter position",
        options: [
          { title: "Center", value: "center" },
          { title: "Left", value: "left" },
          { title: "Right", value: "right" },
        ],
        current: props.settings().position,
      });
      if (value !== undefined) {
        await props.update((draft) => {
          draft.position = value;
        });
        ctx.ui.toast.show({ variant: "success", message: `TPS position: ${value}` });
      }
    } else if (next === "color") {
      const value = await ctx.ui.dialog.prompt({
        title: "TPS colour",
        placeholder: DEFAULT_SETTINGS.color,
        value: props.settings().color,
      });
      // undefined = cancelled; keep the old value, no toast spam.
      if (value !== undefined) {
        if (isValidColor(value)) {
          const color = value.trim();
          await props.update((draft) => {
            draft.color = color;
          });
          ctx.ui.toast.show({ variant: "success", message: `TPS colour: ${color}` });
        } else {
          ctx.ui.toast.show({
            variant: "warning",
            message: `invalid colour "${value}", keeping ${props.settings().color}`,
            duration: 5000,
          });
        }
      }
    } else if (next === "gap") {
      const value = await ctx.ui.dialog.select<number>({
        title: "TPS gap",
        options: [
          { title: "0", value: 0 },
          { title: "1", value: 1 },
          { title: "2", value: 2 },
          { title: "3", value: 3 },
          { title: "4", value: 4 },
          { title: "6", value: 6 },
          { title: "8", value: 8 },
        ],
        current: props.settings().gap,
      });
      if (value !== undefined) {
        await props.update((draft) => {
          draft.gap = clampGap(value);
        });
        ctx.ui.toast.show({ variant: "success", message: `Gap: ${clampGap(value)} columns` });
      }
    } else if (next === "compact" || next === "sidebar" || next === "timer" || next === "bar") {
      const key =
        next === "compact"
          ? "compact"
          : next === "sidebar"
            ? "showSidebar"
            : next === "timer"
              ? "showTimer"
              : "showBar";
      const label =
        next === "compact"
          ? "Compact"
          : next === "sidebar"
            ? "Show sidebar"
            : next === "timer"
              ? "Show timer"
              : "Speed bar";
      const value = await ctx.ui.dialog.select<boolean>({
        title: label,
        options: [
          { title: "On", value: true },
          { title: "Off", value: false },
        ],
        current: props.settings()[key],
      });
      if (value !== undefined) {
        await props.update((draft) => {
          draft[key] = value;
        });
        ctx.ui.toast.show({ variant: "success", message: `${label}: ${value ? "on" : "off"}` });
      }
    } else if (next === "reset") {
      await props.update((draft) => {
        draft.position = DEFAULT_SETTINGS.position;
        draft.color = DEFAULT_SETTINGS.color;
        draft.gap = DEFAULT_SETTINGS.gap;
        draft.compact = DEFAULT_SETTINGS.compact;
        draft.showSidebar = DEFAULT_SETTINGS.showSidebar;
        draft.showTimer = DEFAULT_SETTINGS.showTimer;
        draft.showBar = DEFAULT_SETTINGS.showBar;
      });
      ctx.ui.toast.show({ variant: "success", message: "Opencode2TPS reset to defaults" });
    }

    choice = next === "exit" ? "exit" : "position";
  }
}

export default Plugin.define({
  id: "opencode2tps",
  setup(context) {
    // cli.json options are gone; the durable store is the single source of
    // truth. Create it once so every reader shares the same live instance and
    // hand-edits / cross-instance sync stay reactive.
    const [settingsStore, setSettings] = context.storage.store<Settings>("settings", {
      initial: DEFAULT_SETTINGS,
    });
    // Re-runs whenever the store changes; mergeSettings drops unknown keys and
    // falls back on out-of-range values, so a bad store can't break the meter.
    const settings = (): Settings => mergeSettings(settingsStore).settings;
    // The menu's only mutation path; keeping it in setup avoids a signal the
    // settings accessor would have to know about.
    const update = (mutation: (draft: Settings) => void) => setSettings(mutation);

    const invalid = mergeSettings(settingsStore).invalid;
    if (invalid.length > 0) {
      context.ui.toast.show({
        title: "Opencode2TPS",
        message: `ignoring invalid setting(s): ${invalid.join(", ")}`,
        variant: "warning",
        duration: 5000,
      });
    }

    // Sibling of the built-in status, absolutely positioned to centre across
    // the whole footer row.
    const offFooter = context.ui.slot({
      after: "prompt.footer.status",
      render: ({ sessionID }) => (
        <TpsView sessionID={sessionID} settings={settings} update={update} />
      ),
    });
    // Append below the built-in sidebar blocks. The whole list is hidden — not
    // just its rows — when the user turns the sidebar setting off.
    const offSidebar = context.ui.slot({
      append: "sidebar.content",
      render: ({ sessionID }) => (
        <Show when={settings().showSidebar}>
          <SubagentList sessionID={sessionID} settings={settings} />
        </Show>
      ),
    });
    return () => {
      offFooter();
      offSidebar();
    };
  },
});
