import { test } from "node:test";
import assert from "node:assert/strict";
import { calcTps, formatLine } from "./tps.ts";

test("calcTps divides input+output tokens by wall seconds", () => {
  assert.equal(calcTps(421, 10), 42.1);
});

test("calcTps returns null on zero elapsed", () => {
  assert.equal(calcTps(100, 0), null);
});

test("formatLine matches locked format", () => {
  assert.equal(formatLine(42.1, 3.2), "42.1 t/s | 3.2 s");
});

test("formatLine shows dashes when usage is missing", () => {
  assert.equal(formatLine(null, 3.2), "— t/s | 3.2 s");
});
