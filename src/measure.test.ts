// Covers messageRate (exact + live paths, clamping, null cases), aggregate
// summation, and sessionRun's footer-aligned turn rate.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Context } from "@opencode/plugin/tui/context";
import { aggregate, messageRate, sessionRun, toolSec, turnMessages, turnRate, CHARS_PER_TOKEN, type MsgLike } from "./measure.ts";

const close = (actual: number | null | undefined, expected: number) =>
  assert.ok(Math.abs((actual ?? NaN) - expected) < 1e-9, `${actual} !≈ ${expected}`);

const chars = (type: "text" | "reasoning", n: number) => ({ type, text: "x".repeat(n) });

test("messageRate exact path divides output+reasoning by wall seconds", () => {
  const msg: MsgLike = {
    type: "assistant",
    time: { created: 1000, completed: 6000 },
    tokens: { output: 400, reasoning: 100 },
  };
  close(messageRate(msg, 6000), 500 / 5);
  close(messageRate(msg, 999_999), 100);
});

test("messageRate exact path includes reasoning and zero is fine", () => {
  const msg: MsgLike = { type: "assistant", time: { created: 2000, completed: 6000 }, tokens: { output: 200, reasoning: 0 } };
  close(messageRate(msg, 6000), 50);
});

test("messageRate live path estimates chars over CHARS_PER_TOKEN / elapsed", () => {
  const msg: MsgLike = { time: { created: 0 }, content: [chars("text", 420)] };
  close(messageRate(msg, 10_000), 420 / CHARS_PER_TOKEN / 10);
});

test("messageRate live path counts reasoning parts too", () => {
  const msg: MsgLike = { time: { created: 0 }, content: [chars("text", 210), chars("reasoning", 210)] };
  close(messageRate(msg, 10_000), 420 / CHARS_PER_TOKEN / 10);
});

test("messageRate returns null without created time or without live content", () => {
  assert.equal(messageRate({ content: [chars("text", 100)] }, 10_000), null);
  assert.equal(messageRate({ time: { created: 0 }, content: [] }, 10_000), null);
  assert.equal(messageRate({ time: { created: 0 }, content: undefined }, 10_000), null);
});

test("messageRate clamps a near-zero span to 0.3s instead of Infinity/NaN", () => {
  const msg: MsgLike = { type: "assistant", time: { created: 1000, completed: 1003 }, tokens: { output: 0, reasoning: 0 } };
  const rate = messageRate(msg, 1003);
  assert.ok(Number.isFinite(rate));
  close(rate, 0);
});

test("aggregate sums assistant messages only and ignores user messages", () => {
  const user: MsgLike = { type: "user", time: { created: 0, completed: 4000 }, tokens: { output: 9999 } };
  const assistant: MsgLike = { type: "assistant", time: { created: 0, completed: 2000 }, tokens: { output: 100, reasoning: 0 } };
  const res = aggregate([user, assistant], 5000);
  assert.equal(res.tokens, 100);
  close(res.genSec, 2);
  close(res.avgRate, 50);
});

test("aggregate excludes tool gaps between messages", () => {
  const a: MsgLike = { type: "assistant", time: { created: 0, completed: 2000 }, tokens: { output: 100, reasoning: 0 } };
  const b: MsgLike = { type: "assistant", time: { created: 60_000, completed: 63_000 }, tokens: { output: 200, reasoning: 0 } };
  const res = aggregate([a, b], 63_000);
  close(res.tokens, 300);
  close(res.genSec, 5);
  close(res.avgRate, 60);
});

test("aggregate treats in-flight messages as running until nowMs", () => {
  const inflight: MsgLike = { type: "assistant", time: { created: 1000 }, tokens: undefined, content: [chars("text", 42)] };
  const res = aggregate([inflight], 5000);
  assert.equal(res.tokens, 0);
  close(res.genSec, 4);
});

test("aggregate returns null avgRate when no tokens were reported but genSec > 0", () => {
  const silent: MsgLike = { type: "assistant", time: { created: 0, completed: 2000 }, tokens: undefined };
  const res = aggregate([silent], 5000);
  assert.equal(res.avgRate, null);
  assert.ok(res.genSec > 0);
});

test("turnMessages keeps only what follows the last prompt", () => {
  const old: MsgLike = { type: "assistant", time: { created: 0, completed: 1000 }, tokens: { output: 10 } };
  const prompt: MsgLike = { type: "user", time: { created: 2000 } };
  const fresh: MsgLike = { type: "assistant", time: { created: 3000, completed: 4000 }, tokens: { output: 20 } };
  assert.deepEqual(turnMessages([old, prompt, fresh]), [fresh]);
});

test("toolSec sums completed tool waits and skips the in-flight one", () => {
  const msg: MsgLike = {
    type: "assistant",
    content: [
      { type: "tool", time: { created: 0, completed: 4000 } },
      { type: "tool", time: { created: 5000 } },
      { type: "text", text: "not a tool" },
    ],
  };
  close(toolSec([msg]), 4);
});

test("turnRate adds completed tool waits to the denominator", () => {
  const msg: MsgLike = {
    type: "assistant",
    time: { created: 0, completed: 2000 },
    tokens: { output: 200, reasoning: 0 },
    content: [{ type: "tool", time: { created: 2000, completed: 6000 } }],
  };
  close(turnRate([msg], 6000), 200 / 6);
});

test("turnRate holds through an in-flight tool call, then drops", () => {
  const running: MsgLike = {
    type: "assistant",
    time: { created: 0, completed: 2000 },
    tokens: { output: 200, reasoning: 0 },
    content: [{ type: "tool", time: { created: 2000 } }],
  };
  close(turnRate([running], 999_999), 100);
  running.content = [{ type: "tool", time: { created: 2000, completed: 6000 } }];
  close(turnRate([running], 999_999), 200 / 6);
});

test("turnRate estimates the in-flight step from streamed chars", () => {
  const msg: MsgLike = { type: "assistant", time: { created: 0 }, content: [chars("text", 420)] };
  close(turnRate([msg], 10_000), 420 / CHARS_PER_TOKEN / 10);
});

// sessionRun only reads message.list and status off the context; stub just those.
const ctxFor = (messages: MsgLike[], status: "idle" | "running" = "idle") =>
  ({
    data: {
      session: {
        message: { list: () => messages },
        status: () => status,
      },
    },
  }) as unknown as Context;

test("sessionRun rate matches the footer turn rate, including a completed tool wait", () => {
  const msg: MsgLike = {
    type: "assistant",
    time: { created: 0, completed: 2000 },
    tokens: { output: 200, reasoning: 0 },
    content: [{ type: "tool", time: { created: 2000, completed: 6000 } }],
  };
  const stats = sessionRun(ctxFor([msg]), "child", 6000);
  // 200 tokens over 2s generation + 4s tool wait, exactly like the footer.
  close(stats.rate, 200 / 6);
  close(stats.rate, turnRate(turnMessages([msg]), 6000)!);
  // genSec still excludes the tool wait, tokens still sum output+reasoning.
  close(stats.genSec, 2);
  assert.equal(stats.tokens, 200);
});
