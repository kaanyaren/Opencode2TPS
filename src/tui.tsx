import { createSignal, createEffect, onCleanup } from "solid-js";
import { Plugin, usePlugin } from "@opencode/plugin/tui";
import { calcTps, formatLine } from "./tps";

const TICK_MS = 100;
const FREEZE_AFTER_MS = 1500;

function tokensOf(obj: unknown): number | null {
  if (obj === null || typeof obj !== "object") return null;
  const t = (obj as Record<string, unknown>).tokens;
  if (t === null || typeof t !== "object") return null;
  const rec = t as Record<string, unknown>;
  if (typeof rec.input !== "number" || typeof rec.output !== "number") return null;
  return rec.input + rec.output;
}

function readSessionTokens(ctx: any, sessionID: string): number | null {
  try {
    const session = ctx.data.session.get(sessionID);
    const direct = tokensOf(session);
    if (direct !== null) return direct;
    const messages = ctx.data.session.message.list(sessionID);
    if (!Array.isArray(messages)) return null;
    let sum = 0;
    let found = false;
    for (const m of messages) {
      const n = tokensOf(m) ?? tokensOf((m as any)?.info);
      if (n !== null) {
        sum += n;
        found = true;
      }
    }
    return found ? sum : null;
  } catch {
    return null;
  }
}

function readStatus(ctx: any, sessionID: string): string {
  try {
    const s = ctx.data.session.status(sessionID);
    if (typeof s === "string") return s;
    if (s !== null && typeof s === "object") return String((s as any).type ?? "");
    return "";
  } catch {
    return "";
  }
}

function TpsView(props: { sessionID?: string }) {
  const ctx = usePlugin() as any;
  const [label, setLabel] = createSignal<string | null>(null);

  let baseTokens = 0;
  let baseAt = 0;
  let streaming = false;
  let lastTokens: number | null = null;
  let lastChangeAt = 0;

  const reset = () => {
    baseTokens = 0;
    baseAt = 0;
    streaming = false;
    lastTokens = null;
    lastChangeAt = 0;
    setLabel(null);
  };

  createEffect(() => {
    void props.sessionID;
    reset();
    tick();
  });

  const tick = () => {
    const sessionID = props.sessionID;
    if (!sessionID) return;
    const now = Date.now();
    const status = readStatus(ctx, sessionID);
    const cur = readSessionTokens(ctx, sessionID);
    if (cur !== null && cur !== lastTokens) {
      lastTokens = cur;
      lastChangeAt = now;
    }

    const busy =
      status === "busy" ||
      status === "retry" ||
      (status === "" && lastTokens !== null && now - lastChangeAt < FREEZE_AFTER_MS);

    if (busy) {
      if (!streaming) {
        streaming = true;
        baseAt = now;
        baseTokens = cur ?? 0;
      }
      const elapsed = (now - baseAt) / 1000;
      const delta = cur === null ? 0 : Math.max(0, cur - baseTokens);
      setLabel(formatLine(cur === null ? null : calcTps(delta, elapsed), elapsed));
    } else if (status === "idle" || status === "") {
      streaming = false;
    }
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

  return <>{label() !== null ? <text>{label()}</text> : null}</>;
}

export default Plugin.define({
  id: "opencode2tps.tui",
  setup(context) {
    // Prepend so the meter sits before the context/cost data in the status row.
    const off = (context as any).ui.slot({
      prepend: "prompt.footer.status",
      render: ({ sessionID }: { sessionID?: string }) => <TpsView sessionID={sessionID} />,
    });
    return () => off();
  },
});
