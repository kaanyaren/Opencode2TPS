import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_OPTIONS,
  MINT,
  formatSeconds,
  formatTps,
  justifyFor,
  meterSegments,
  meterTier,
  normalizeOptions,
  subagentSegments,
} from "./options.ts";

test("meterTier hides below the compact threshold", () => {
  assert.equal(meterTier(43, false), "hidden");
  assert.equal(meterTier(0, false), "hidden");
  assert.equal(meterTier(-5, false), "hidden");
});

test("meterTier is compact from 44 up to 71", () => {
  assert.equal(meterTier(44, false), "compact");
  assert.equal(meterTier(71, false), "compact");
});

test("meterTier is full from 72 up", () => {
  assert.equal(meterTier(72, false), "full");
  assert.equal(meterTier(200, false), "full");
});

test("meterTier compact:true forces compact at wide widths", () => {
  assert.equal(meterTier(72, true), "compact");
  assert.equal(meterTier(200, true), "compact");
});

test("meterTier hidden wins even when compact:true", () => {
  assert.equal(meterTier(43, true), "hidden");
});

test("meterTier hides on non-finite width", () => {
  assert.equal(meterTier(NaN, false), "hidden");
  assert.equal(meterTier(Infinity, false), "hidden");
  assert.equal(meterTier(-Infinity, false), "hidden");
});

test("justifyFor maps positions to flex justification", () => {
  assert.equal(justifyFor("left"), "flex-start");
  assert.equal(justifyFor("right"), "flex-end");
  assert.equal(justifyFor("center"), "center");
});

test("meterSegments renders nothing when hidden", () => {
  assert.deepEqual(meterSegments(42.1, 3.2, "hidden"), []);
});

test("meterSegments renders one accented value when compact", () => {
  assert.deepEqual(meterSegments(42.1, 3.2, "compact"), [{ text: "42.1", accent: true }]);
});

test("meterSegments compact renders dashes for null tps", () => {
  assert.deepEqual(meterSegments(null, 3.2, "compact"), [{ text: "—", accent: true }]);
});

test("meterSegments full accents value and label, not the timer", () => {
  assert.deepEqual(meterSegments(42.1, 3.2, "full"), [
    { text: "42.1", accent: true },
    { text: " tps", accent: true },
    { text: " | 3.2 s" },
  ]);
});

test("meterSegments full renders dashes for null tps", () => {
  assert.deepEqual(meterSegments(null, 3.2, "full"), [
    { text: "—", accent: true },
    { text: " tps", accent: true },
    { text: " | 3.2 s" },
  ]);
});

test("formatTps fixes one decimal", () => {
  assert.equal(formatTps(42.1), "42.1");
  assert.equal(formatTps(7), "7.0");
  assert.equal(formatTps(0), "0.0");
});

test("formatTps dashes a null value", () => {
  assert.equal(formatTps(null), "—");
});

test("formatSeconds fixes one decimal for valid seconds", () => {
  assert.equal(formatSeconds(3.2), "3.2");
  assert.equal(formatSeconds(0), "0.0");
});

test("formatSeconds dashes NaN, negative and infinite seconds", () => {
  assert.equal(formatSeconds(NaN), "—");
  assert.equal(formatSeconds(-1), "—");
  assert.equal(formatSeconds(Infinity), "—");
});

test("normalizeOptions defaults on undefined and null", () => {
  assert.deepEqual(normalizeOptions(undefined), { options: DEFAULT_OPTIONS, invalid: [] });
  assert.deepEqual(normalizeOptions(null), { options: DEFAULT_OPTIONS, invalid: [] });
});

test("normalizeOptions flags a non-object with <options>", () => {
  assert.deepEqual(normalizeOptions(42), { options: DEFAULT_OPTIONS, invalid: ["<options>"] });
  assert.deepEqual(normalizeOptions("nope"), { options: DEFAULT_OPTIONS, invalid: ["<options>"] });
  assert.deepEqual(normalizeOptions(true), { options: DEFAULT_OPTIONS, invalid: ["<options>"] });
});

test("normalizeOptions passes valid values through", () => {
  assert.deepEqual(normalizeOptions({ position: "left", color: "#AbC", compact: true }), {
    options: { position: "left", color: "#AbC", compact: true },
    invalid: [],
  });
});

test("normalizeOptions accepts 3, 6 and 8 digit hex", () => {
  assert.equal(normalizeOptions({ color: "#abc" }).options.color, "#abc");
  assert.equal(normalizeOptions({ color: "#aabbcc" }).options.color, "#aabbcc");
  assert.equal(normalizeOptions({ color: "#aabbccdd" }).options.color, "#aabbccdd");
});

test("normalizeOptions trims whitespace around a valid hex", () => {
  const result = normalizeOptions({ color: "  #aabbcc\t" });
  assert.equal(result.options.color, "#aabbcc");
  assert.deepEqual(result.invalid, []);
});

test("normalizeOptions falls back on invalid position", () => {
  const result = normalizeOptions({ position: "top" });
  assert.equal(result.options.position, DEFAULT_OPTIONS.position);
  assert.deepEqual(result.invalid, ["position"]);
});

test("normalizeOptions falls back on invalid color", () => {
  for (const color of ["mint", "#12", 123]) {
    const result = normalizeOptions({ color });
    assert.equal(result.options.color, MINT);
    assert.deepEqual(result.invalid, ["color"]);
  }
});

test("normalizeOptions falls back on invalid compact", () => {
  const result = normalizeOptions({ compact: "yes" });
  assert.equal(result.options.compact, false);
  assert.deepEqual(result.invalid, ["compact"]);
});

test("normalizeOptions collects every invalid key", () => {
  const result = normalizeOptions({ position: "up", color: "mint", compact: "yes" });
  assert.deepEqual(result.options, DEFAULT_OPTIONS);
  assert.deepEqual(result.invalid, ["position", "color", "compact"]);
});

test("subagentSegments prefixes unaccented, accents tps, ends unaccented", () => {
  assert.deepEqual(subagentSegments("⏺", "agent", 42.1, 3.2), [
    { text: "⏺ agent  " },
    { text: "42.1", accent: true },
    { text: " tps", accent: true },
    { text: "  3.2 s" },
  ]);
});

test("subagentSegments dashes a null tps", () => {
  assert.deepEqual(subagentSegments("⏺", "agent", null, 3.2), [
    { text: "⏺ agent  " },
    { text: "—", accent: true },
    { text: " tps", accent: true },
    { text: "  3.2 s" },
  ]);
});
