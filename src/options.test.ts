import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BAR_CELLS,
  BAR_EMPTY,
  BAR_FILLED,
  DEFAULT_SETTINGS,
  MINT,
  formatSeconds,
  formatTps,
  isValidColor,
  justifyFor,
  mergeSettings,
  meterSegments,
  meterTier,
  observedMax,
  speedBar,
  subagentSegments,
} from "./options.ts";

test("meterTier hides below the compact minimum", () => {
  assert.equal(meterTier(0, false), "hidden");
  assert.equal(meterTier(43, false), "hidden");
});

test("meterTier is compact from 44 up to the full minimum", () => {
  assert.equal(meterTier(44, false), "compact");
  assert.equal(meterTier(71, false), "compact");
});

test("meterTier is full at and above the full minimum", () => {
  assert.equal(meterTier(72, false), "full");
  assert.equal(meterTier(120, false), "full");
});

test("meterTier forces compact at wide widths when compact is set", () => {
  assert.equal(meterTier(120, true), "compact");
});

test("meterTier hides non-finite widths", () => {
  assert.equal(meterTier(Number.NaN, false), "hidden");
  assert.equal(meterTier(Number.POSITIVE_INFINITY, false), "hidden");
});

test("justifyFor maps positions to flex alignment", () => {
  assert.equal(justifyFor("left"), "flex-start");
  assert.equal(justifyFor("right"), "flex-end");
  assert.equal(justifyFor("center"), "center");
});

test("meterSegments renders nothing when hidden", () => {
  assert.deepEqual(meterSegments(42.1, 3.2, "hidden", true, ""), []);
});

test("meterSegments compact emits one accented value", () => {
  assert.deepEqual(meterSegments(42.1, 3.2, "compact", true, ""), [
    { text: "42.1", accent: true },
  ]);
});

test("meterSegments full with timer appends an unaccented timer", () => {
  assert.deepEqual(meterSegments(42.1, 3.2, "full", true, ""), [
    { text: "42.1", accent: true },
    { text: " tps", accent: true },
    { text: " | 3.2 s" },
  ]);
});

test("meterSegments full without timer emits exactly two segments", () => {
  const segments = meterSegments(42.1, 3.2, "full", false, "");
  assert.equal(segments.length, 2);
  assert.deepEqual(segments, [
    { text: "42.1", accent: true },
    { text: " tps", accent: true },
  ]);
});

test("meterSegments renders a dash for null tps", () => {
  assert.deepEqual(meterSegments(null, 3.2, "compact", false, ""), [
    { text: "—", accent: true },
  ]);
  assert.deepEqual(meterSegments(null, 3.2, "full", true, ""), [
    { text: "—", accent: true },
    { text: " tps", accent: true },
    { text: " | 3.2 s" },
  ]);
});

test("meterSegments full with a bar puts an accented bar segment first", () => {
  const segments = meterSegments(42.1, 3.2, "full", false, "abcde");
  assert.deepEqual(segments, [
    { text: "abcde ", accent: true },
    { text: "42.1", accent: true },
    { text: " tps", accent: true },
  ]);
  assert.equal(segments[0].text, "abcde ");
  assert.equal(segments[0].accent, true);
});

test("meterSegments compact with a bar emits accented bar plus accented value", () => {
  const segments = meterSegments(42.1, 3.2, "compact", false, "abcde");
  assert.deepEqual(segments, [
    { text: "abcde ", accent: true },
    { text: "42.1", accent: true },
  ]);
  assert.equal(segments[0].accent, true);
  assert.equal(segments[1].accent, true);
});

test("meterSegments compact without a bar emits a single accented value", () => {
  const segments = meterSegments(42.1, 3.2, "compact", false, "");
  assert.deepEqual(segments, [{ text: "42.1", accent: true }]);
  assert.equal(segments.length, 1);
});

test("speedBar renders all empty for null, zero and non-positive scale", () => {
  const empty = BAR_EMPTY.repeat(BAR_CELLS);
  assert.equal(speedBar(null, 100), empty);
  assert.equal(speedBar(0, 100), empty);
  assert.equal(speedBar(10, 0), empty);
  assert.equal(speedBar(10, -5), empty);
  assert.equal(speedBar(Number.NaN, 100), empty);
});

test("speedBar fills fully at and above the max", () => {
  const filled = BAR_FILLED.repeat(BAR_CELLS);
  assert.equal(speedBar(100, 100), filled);
  assert.equal(speedBar(200, 100), filled);
});

test("speedBar fills proportionally in between", () => {
  assert.equal(speedBar(50, 100), BAR_FILLED.repeat(4) + BAR_EMPTY.repeat(4));
});

test("speedBar is always exactly BAR_CELLS characters", () => {
  for (const [tps, max] of [
    [null, 100],
    [0, 100],
    [100, 100],
    [200, 100],
    [50, 100],
    [10, 0],
    [10, -5],
    [Number.NaN, 100],
  ] as const) {
    assert.equal(speedBar(tps, max).length, BAR_CELLS);
  }
});

test("observedMax grows to the current value", () => {
  assert.equal(observedMax(120, 0, 0), 120);
  assert.equal(observedMax(50, 20, 0), 50);
});

test("observedMax keeps a larger previous max", () => {
  assert.equal(observedMax(20, 80, 0), 80);
  assert.equal(observedMax(20, 0, 100), 100);
});

test("observedMax ignores nulls, negatives and NaN", () => {
  assert.equal(observedMax(null, -10, Number.NaN), 0);
  assert.equal(observedMax(null, 0, 0), 0);
  assert.equal(observedMax(Number.NaN, -5, -1), 0);
  assert.equal(observedMax(-3, 0, 0), 0);
});

test("formatTps formats numbers and dashes null", () => {
  assert.equal(formatTps(42.14), "42.1");
  assert.equal(formatTps(0), "0.0");
  assert.equal(formatTps(null), "—");
});

test("formatSeconds formats finite non-negative seconds and dashes the rest", () => {
  assert.equal(formatSeconds(3.25), "3.3");
  assert.equal(formatSeconds(0), "0.0");
  assert.equal(formatSeconds(Number.NaN), "—");
  assert.equal(formatSeconds(-1), "—");
  assert.equal(formatSeconds(Number.POSITIVE_INFINITY), "—");
});

test("isValidColor accepts 3, 6 and 8 digit hex with whitespace", () => {
  assert.equal(isValidColor("#abc"), true);
  assert.equal(isValidColor(" #abc "), true);
  assert.equal(isValidColor("#aabbcc"), true);
  assert.equal(isValidColor("#aabbccdd"), true);
});

test("isValidColor rejects named colours and short hex", () => {
  assert.equal(isValidColor("mint"), false);
  assert.equal(isValidColor("#12"), false);
});

test("mergeSettings defaults for undefined and null", () => {
  assert.deepEqual(mergeSettings(undefined), { settings: DEFAULT_SETTINGS, invalid: [] });
  assert.deepEqual(mergeSettings(null), { settings: DEFAULT_SETTINGS, invalid: [] });
});

test("mergeSettings flags non-objects as invalid", () => {
  assert.deepEqual(mergeSettings(42), { settings: DEFAULT_SETTINGS, invalid: ["<settings>"] });
  assert.deepEqual(mergeSettings("x"), { settings: DEFAULT_SETTINGS, invalid: ["<settings>"] });
});

test("mergeSettings passes a valid partial through", () => {
  const { settings, invalid } = mergeSettings({ position: "left", color: "#abc" });
  assert.deepEqual(settings, { ...DEFAULT_SETTINGS, position: "left", color: "#abc" });
  assert.deepEqual(invalid, []);
});

test("mergeSettings falls back and lists invalid position/color/booleans", () => {
  const { settings, invalid } = mergeSettings({
    position: "top",
    color: "mint",
    compact: "yes",
    showSidebar: 1,
    showTimer: null,
  });
  assert.deepEqual(settings, DEFAULT_SETTINGS);
  assert.deepEqual(invalid, ["position", "color", "compact", "showSidebar", "showTimer"]);
});

test("mergeSettings ignores unknown keys", () => {
  const { settings, invalid } = mergeSettings({ nope: true, color: "#112233" });
  assert.deepEqual(settings, { ...DEFAULT_SETTINGS, color: "#112233" });
  assert.deepEqual(invalid, []);
});

for (const value of [true, false]) {
  test(`mergeSettings accepts boolean ${value} for compact/showSidebar/showTimer`, () => {
    const { settings, invalid } = mergeSettings({
      compact: value,
      showSidebar: value,
      showTimer: value,
    });
    assert.deepEqual(settings, {
      ...DEFAULT_SETTINGS,
      compact: value,
      showSidebar: value,
      showTimer: value,
    });
    assert.deepEqual(invalid, []);
  });
}

test("mergeSettings accepts showBar booleans and defaults it to true", () => {
  assert.equal(DEFAULT_SETTINGS.showBar, true);
  for (const value of [true, false]) {
    const { settings, invalid } = mergeSettings({ showBar: value });
    assert.equal(settings.showBar, value);
    assert.deepEqual(invalid, []);
  }
});

test("mergeSettings falls back on a non-boolean showBar and lists it", () => {
  const { settings, invalid } = mergeSettings({ showBar: "yes" });
  assert.equal(settings.showBar, DEFAULT_SETTINGS.showBar);
  assert.deepEqual(invalid, ["showBar"]);
});

test("mergeSettings defaults showSidebar and showTimer to true", () => {
  assert.equal(DEFAULT_SETTINGS.showSidebar, true);
  assert.equal(DEFAULT_SETTINGS.showTimer, true);
  assert.equal(DEFAULT_SETTINGS.color, MINT);
});

test("subagentSegments accents the value and label only", () => {
  assert.deepEqual(subagentSegments("›", "agent", 42.1, 3.2), [
    { text: "› agent  " },
    { text: "42.1", accent: true },
    { text: " tps", accent: true },
    { text: "  3.2 s" },
  ]);
});
