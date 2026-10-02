// Pure option + layout helpers shared by the footer meter and the sidebar.
// No OpenCode imports, so it stays unit-testable under `node --test`.

export const MINT = "#6ee7b7";

export type Position = "center" | "left" | "right";
export type MeterOptions = {
  position: Position;
  color: string;
  compact: boolean;
};

export const DEFAULT_OPTIONS: MeterOptions = {
  position: "center",
  color: MINT,
  compact: false,
};

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

// Footer meter. `tier === "hidden"` means render nothing at all.
export function meterSegments(tps: number | null, sec: number, tier: MeterTier): Segment[] {
  if (tier === "hidden") return [];
  const value = formatTps(tps);
  if (tier === "compact") return [{ text: value, accent: true }];
  return [
    { text: value, accent: true },
    { text: " tps", accent: true },
    { text: ` | ${formatSeconds(sec)} s` },
  ];
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

// Validate user options from cli.json. Unknown/invalid values fall back to the
// default; the caller surfaces `invalid` once (trust-boundary validation).
export function normalizeOptions(raw: unknown): { options: MeterOptions; invalid: string[] } {
  const invalid: string[] = [];
  const options: MeterOptions = { ...DEFAULT_OPTIONS };
  if (raw === undefined || raw === null) return { options, invalid };
  if (typeof raw !== "object") return { options, invalid: ["<options>"] };

  const value = raw as Record<string, unknown>;
  if ("position" in value) {
    const position = value.position;
    if (position === "center" || position === "left" || position === "right") {
      options.position = position;
    } else {
      invalid.push("position");
    }
  }
  if ("color" in value) {
    const color = value.color;
    if (typeof color === "string" && HEX.test(color.trim())) {
      options.color = color.trim();
    } else {
      invalid.push("color");
    }
  }
  if ("compact" in value) {
    if (typeof value.compact === "boolean") {
      options.compact = value.compact;
    } else {
      invalid.push("compact");
    }
  }
  return { options, invalid };
}
