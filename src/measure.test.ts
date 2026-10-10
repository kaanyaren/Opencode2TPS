// Covers estimateTokens (split text/reasoning rates), tool-overlap subtraction,
// the windowed turnRate (stale output ages out, stalls hold steady), aggregate
// summation, and sessionRun's running-vs-finished rate scopes.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Context } from "@opencode/plugin/tui/context";
import { aggregate, estimateTokens, netGenMs, sessionRun, toolOverlapMs, toolSec, turnEnd, turnMessages, turnRate, CHARS_PER_TOKEN_TEXT, CHARS_PER_TOKEN_REASONING, RATE_WINDOW_SEC, type MsgLike } from "./measure.ts";

const close = (actual: number | null | undefined, expected: number) =>
  assert.ok(Math.abs((actual ?? NaN) - expected) < 1e-9, `${actual} !≈ ${expected}`);

const chars = (type: "text" | "reasoning", n: number) => ({ type, text: "x".repeat(n) });

test("estimateTokens uses separate rates for text and reasoning", () => {
  const msg: MsgLike = { content: [chars("text", 470), chars("reasoning", 400)] };
  close(estimateTokens(msg), 470 / CHARS_PER_TOKEN_TEXT + 400 / CHARS_PER_TOKEN_REASONING);
});

test("estimateTokens ignores non-text parts and missing content", () => {
  assert.equal(estimateTokens({ content: [{ type: "tool", text: "xx" }] }), 0);
  assert.equal(estimateTokens({ content: [] }), 0);
  assert.equal(estimateTokens({ content: undefined }), 0);
});

test("toolOverlapMs clamps tool waits to the queried interval", () => {
  const msg: MsgLike = {
    content: [
      { type: "tool", time: { created: 1000, completed: 5000 } },
      { type: "tool", time: { created: 8000 } },
    ],
  };
  close(toolOverlapMs(msg, 0, 10_000, 10_000), 4000 + 2000);
  close(toolOverlapMs(msg, 0, 2000, 10_000), 1000);
  close(toolOverlapMs(msg, 6000, 7000, 10_000), 0);
});

test("netGenMs subtracts a tool nested inside the message span", () => {
  const msg: MsgLike = {
    type: "assistant",
    time: { created: 0, completed: 10_000 },
    content: [{ type: "tool", time: { created: 2000, completed: 8000 } }],
  };
  close(netGenMs(msg, 10_000), 4000);
});

test("netGenMs subtracts the in-flight tool up to nowMs", () => {
  const msg: MsgLike = {
    type: "assistant",
    time: { created: 0 },
    content: [{ type: "tool", time: { created: 2000 } }],
  };
  close(netGenMs(msg, 10_000), 2000);
});

test("netGenMs returns null without created time", () => {
  assert.equal(netGenMs({ time: {} }, 10_000), null);
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

test("aggregate subtracts tool time nested inside a message span", () => {
  const msg: MsgLike = {
    type: "assistant",
    time: { created: 0, completed: 10_000 },
    tokens: { output: 400, reasoning: 0 },
    content: [{ type: "tool", time: { created: 2000, completed: 8000 } }],
  };
  const res = aggregate([msg], 10_000);
  close(res.genSec, 4);
  close(res.avgRate!, 100);
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

test("turnRate excludes a tool nested inside the message span", () => {
  const msg: MsgLike = {
    type: "assistant",
    time: { created: 0, completed: 4000 },
    tokens: { output: 400, reasoning: 0 },
    content: [{ type: "tool", time: { created: 1000, completed: 3000 } }],
  };
  // 400 tokens over 4s wall but only 2s generation.
  close(turnRate([msg], 4000), 400 / 2);
});

test("turnRate holds steady through and after a tool call", () => {
  const running: MsgLike = {
    type: "assistant",
    time: { created: 0, completed: 2000 },
    tokens: { output: 200, reasoning: 0 },
    content: [{ type: "tool", time: { created: 2000 } }],
  };
  close(turnRate([running], 999_999), 100);
  running.content = [{ type: "tool", time: { created: 2000, completed: 6000 } }];
  close(turnRate([running], 999_999), 100);
});

test("turnRate recovers after a long tool once fast generation resumes", () => {
  const first: MsgLike = {
    type: "assistant",
    time: { created: 0, completed: 2000 },
    tokens: { output: 200, reasoning: 0 },
    content: [{ type: "tool", time: { created: 2000, completed: 62_000 } }],
  };
  const second: MsgLike = {
    type: "assistant",
    time: { created: 62_000, completed: 64_000 },
    tokens: { output: 300, reasoning: 0 },
  };
  // Windowed: only the recent 300 tokens over 2s count (150 tps), not the
  // turn-cumulative 500 over 4s (125 tps) — and never the 60s grep.
  close(turnRate([first, second], 64_000), 300 / 2);
});

test("turnRate lets stale slow output age out of the window", () => {
  const slow: MsgLike = {
    type: "assistant",
    time: { created: 0, completed: 20_000 },
    tokens: { output: 100, reasoning: 0 },
  };
  const fast: MsgLike = {
    type: "assistant",
    time: { created: 60_000, completed: 62_000 },
    tokens: { output: 200, reasoning: 0 },
  };
  // 20s-old output is outside the window: 100 tps, not 300/22 ≈ 13.6.
  close(turnRate([slow, fast], 62_000), 200 / 2);
});

test("turnRate holds the turn average mid-stall instead of blanking", () => {
  const msg: MsgLike = {
    type: "assistant",
    time: { created: 0, completed: 2000 },
    tokens: { output: 200, reasoning: 0 },
  };
  // Nothing generated within the window, so the cumulative 100 tps shows.
  close(turnRate([msg], 120_000), 100);
});

test("turnRate returns null when nothing generated any tokens", () => {
  const silent: MsgLike = { type: "assistant", time: { created: 0, completed: 2000 } };
  assert.equal(turnRate([silent], 5000), null);
  assert.equal(turnRate([], 5000), null);
});

test("turnRate estimates the in-flight step from streamed chars", () => {
  const msg: MsgLike = { type: "assistant", time: { created: 0 }, content: [chars("text", 470)] };
  close(turnRate([msg], 10_000), 470 / CHARS_PER_TOKEN_TEXT / 10);
});

test("turnRate estimates reasoning chars at the denser rate", () => {
  const msg: MsgLike = { type: "assistant", time: { created: 0 }, content: [chars("reasoning", 400)] };
  close(turnRate([msg], 10_000), 400 / CHARS_PER_TOKEN_REASONING / 10);
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

test("sessionRun shows the live turn rate while running", () => {
  const first: MsgLike = {
    type: "assistant",
    time: { created: 0, completed: 2000 },
    tokens: { output: 200, reasoning: 0 },
  };
  const prompt: MsgLike = { type: "user", time: { created: 5000 } };
  const second: MsgLike = {
    type: "assistant",
    time: { created: 10_000, completed: 14_000 },
    tokens: { output: 100, reasoning: 0 },
  };
  const messages = [first, prompt, second];
  const stats = sessionRun(ctxFor(messages, "running"), "child", 20_000);
  // Live turn rate over the current turn only, exactly like the footer.
  close(stats.rate, turnRate(turnMessages(messages), 20_000)!);
  close(stats.rate!, 100 / 4);
  // Totals still cover the whole session.
  close(stats.genSec, 6);
  assert.equal(stats.tokens, 300);
});

test("sessionRun freezes finished rows on the session average, not the last turn", () => {
  const first: MsgLike = {
    type: "assistant",
    time: { created: 0, completed: 2000 },
    tokens: { output: 200, reasoning: 0 },
  };
  const prompt: MsgLike = { type: "user", time: { created: 5000 } };
  const second: MsgLike = {
    type: "assistant",
    time: { created: 10_000, completed: 14_000 },
    tokens: { output: 100, reasoning: 0 },
  };
  const stats = sessionRun(ctxFor([first, prompt, second], "idle"), "child", 20_000);
  // 300 tokens over 6s session-wide — not the last turn's 25 tps.
  close(stats.rate, 300 / 6);
  close(stats.genSec, 6);
  assert.equal(stats.tokens, 300);
});

test("turnEnd anchors to the latest assistant completion, not mount time", () => {
  const done: MsgLike = { type: "assistant", time: { created: 0, completed: 5000 } };
  const later: MsgLike = { type: "assistant", time: { created: 5000, completed: 8000 } };
  // Latest completion wins, so a remounted meter freezes at the real end.
  assert.equal(turnEnd([done, later], 999_999), 8000);
  // An in-flight assistant (no completed) falls back to the supplied now.
  assert.equal(turnEnd([done, { type: "assistant", time: { created: 8000 } }], 9000), 9000);
  // No assistant at all (prompt just sent) also falls back.
  assert.equal(turnEnd([{ type: "user" }], 1234), 1234);
  // Non-numeric completed values are ignored.
  assert.equal(turnEnd([{ type: "assistant", time: { created: 0, completed: Number.NaN } }], 77), 77);
});
