// Pure settings + layout helpers shared by the footer meter, the sidebar and
// the /tps menu. No OpenCode imports, so it stays unit-testable.

export const MINT = "#6ee7b7";

export type Position = "center" | "left" | "right";

export type Settings = {
  position: Position;
  color: string;
  compact: boolean;
  showSidebar: boolean;
  showTimer: boolean;
  showBar: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  position: "center",
  color: MINT,
  compact: false,
  showSidebar: true,
  showTimer: true,
  showBar: true,
};

// Fixed-width speed bar: 10 cells, one space each side, so at most 12 columns.
export const BAR_CELLS = 8;
export const BAR_FILLED = "█";
export const BAR_EMPTY = "░";

// Footer width tiers, in terminal columns. Hidden wins at any width.
export const WIDTH_FULL_MIN = 72;
export const WIDTH_COMPACT_MIN = 44;

export type MeterTier = "full" | "compact" | "hidden";

export function meterTier(width: number, compact: boolean): MeterTier {
  if (!Number.isFinite(width) || width < WIDTH_COMPACT_MIN) return "hidden";
  if (compact || width < WIDTH_FULL_MIN) return "compact";
  return "full";
}

export function justifyFor(position: Position): "flex-start" | "center" | "flex-end" {
  if (position === "left") return "flex-start";
  if (position === "right") return "flex-end";
  return "center";
}

// One run of text plus whether it uses the configured accent colour.
export type Segment = { text: string; accent?: boolean };

export function formatTps(tps: number | null): string {
  return tps === null ? "—" : tps.toFixed(1);
}

export function formatSeconds(sec: number): string {
  return Number.isFinite(sec) && sec >= 0 ? sec.toFixed(1) : "—";
}

// Speed bar against the session's observed max: zero tps is a fully empty bar,
// `max` (or more) is fully filled. Null tps (no data yet) renders empty.
export function speedBar(tps: number | null, max: number): string {
  const ratio = tps === null || !Number.isFinite(tps) || max <= 0 ? 0 : tps / max;
  const clamped = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
  const filled = Math.round(clamped * BAR_CELLS);
  return BAR_FILLED.repeat(filled) + BAR_EMPTY.repeat(BAR_CELLS - filled);
}

// Highest tps a session has produced, used as the bar's full-scale. Kept here
// so the view stays a thin render over pure logic.
export function observedMax(currentTps: number | null, sessionMax: number, previousMax: number): number {
  const candidates = [sessionMax, previousMax, currentTps ?? 0].filter(
    (value) => Number.isFinite(value) && value > 0,
  );
  return candidates.length > 0 ? Math.max(...candidates) : 0;
}

// Footer meter. `tier === "hidden"` means render nothing at all; `showTimer`
// is a user toggle, so compact stays a pure width/compact decision. `bar` is a
// pre-rendered speed bar placed just before the value.
export function meterSegments(
  tps: number | null,
  sec: number,
  tier: MeterTier,
  showTimer: boolean,
  bar: string,
): Segment[] {
  if (tier === "hidden") return [];
  const value = formatTps(tps);
  if (tier === "compact") {
    return bar
      ? [{ text: `${bar} `, accent: true }, { text: value, accent: true }]
      : [{ text: value, accent: true }];
  }
  const segments: Segment[] = [];
  if (bar) segments.push({ text: `${bar} `, accent: true });
  segments.push({ text: value, accent: true }, { text: " tps", accent: true });
  if (showTimer) segments.push({ text: ` | ${formatSeconds(sec)} s` });
  return segments;
}

// Sidebar subagent row. Same accent treatment as the footer's tps value/label.
export function subagentSegments(
  marker: string,
  label: string,
  tps: number | null,
  genSec: number,
): Segment[] {
  return [
    { text: `${marker} ${label}  ` },
    { text: formatTps(tps), accent: true },
    { text: " tps", accent: true },
    { text: `  ${genSec.toFixed(1)} s` },
  ];
}

const HEX = /^#[0-9a-fA-F]{3,8}$/;

export function isValidColor(value: string): boolean {
  return HEX.test(value.trim());
}

// Merge a partial (from the durable store) over the defaults. Unknown keys are
// dropped and out-of-range values fall back, so a hand-edited store can never
// produce an unrenderable meter.
export function mergeSettings(raw: unknown): { settings: Settings; invalid: string[] } {
  const invalid: string[] = [];
  const settings: Settings = { ...DEFAULT_SETTINGS };
  if (raw === undefined || raw === null) return { settings, invalid };
  if (typeof raw !== "object") return { settings, invalid: ["<settings>"] };

  const value = raw as Record<string, unknown>;
  if ("position" in value) {
    const position = value.position;
    if (position === "center" || position === "left" || position === "right") {
      settings.position = position;
    } else invalid.push("position");
  }
  if ("color" in value) {
    const color = value.color;
    if (typeof color === "string" && isValidColor(color)) settings.color = color.trim();
    else invalid.push("color");
  }
  for (const key of ["compact", "showSidebar", "showTimer", "showBar"] as const) {
    if (key in value) {
      if (typeof value[key] === "boolean") settings[key] = value[key];
      else invalid.push(key);
    }
  }
  return { settings, invalid };
}
