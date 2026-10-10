// Shared session measurement for the footer meter and the sidebar list.
// Reads are defensive: a missing/unsynced session must never throw.

import type { Context } from "@opencode/plugin/tui/context";
import { calcTps } from "./tps.ts";

// Chars-per-token for the live estimate before reported usage lands.
// Measured on real traffic: text ~4.7, reasoning ~4.0.
export const CHARS_PER_TOKEN_TEXT = 4.7;
export const CHARS_PER_TOKEN_REASONING = 4.0;
// Recent-generation window for the live rate, in seconds. Whole-turn
// averaging is the same long-bucket bug as tool waits: early slow output
// drags later fast output, so the meter reflects the recent window.
export const RATE_WINDOW_SEC = 15;
// Near-zero spans would produce absurd rates; floor the divisor.
const MIN_SPAN_SEC = 0.3;

export type MsgLike = {
  id?: unknown;
  type?: unknown;
  time?: { created?: unknown; completed?: unknown };
  tokens?: { output?: unknown; reasoning?: unknown };
  content?: unknown;
};

export type UserLike = { id: string; created: number };

export type RunStats = {
  running: boolean;
  rate: number | null;
  /** Generation seconds: sum of message lifetimes, tool waits excluded. */
  genSec: number;
  tokens: number;
};

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readMessages(ctx: Context, sessionID: string): MsgLike[] {
  try {
    const messages = ctx.data.session.message.list(sessionID);
    return Array.isArray(messages) ? (messages as MsgLike[]) : [];
  } catch {
    return [];
  }
}

export function readLastUser(messages: MsgLike[]): UserLike | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.type === "user" && typeof msg.id === "string") {
      const created = num(msg.time?.created);
      return { id: msg.id, created: created ?? 0 };
    }
  }
  return null;
}

// Streamed text + reasoning characters as estimated tokens, with a separate
// rate for each: reasoning runs denser than prose. Both count — counting only
// visible text reads ~0 while the model thinks.
export function estimateTokens(msg: MsgLike): number {
  if (!Array.isArray(msg.content)) return 0;
  let text = 0;
  let reasoning = 0;
  for (const part of msg.content) {
    const p = part as { type?: unknown; text?: unknown };
    if (typeof p.text !== "string") continue;
    if (p?.type === "text") text += p.text.length;
    else if (p?.type === "reasoning") reasoning += p.text.length;
  }
  return text / CHARS_PER_TOKEN_TEXT + reasoning / CHARS_PER_TOKEN_REASONING;
}

export function readStatus(ctx: Context, sessionID: string): "idle" | "running" {
  try {
    return ctx.data.session.status(sessionID);
  } catch {
    return "idle";
  }
}

// Milliseconds of tool execution overlapping [from, to], clamped per call.
// Covers completed waits and the in-flight one (measured to nowMs): a tool
// running inside a message's lifetime otherwise reads as generation time.
export function toolOverlapMs(msg: MsgLike, from: number, to: number, nowMs: number): number {
  if (!Array.isArray(msg.content)) return 0;
  let ms = 0;
  for (const part of msg.content) {
    const p = part as { type?: unknown; time?: { created?: unknown; completed?: unknown } };
    if (p?.type !== "tool") continue;
    const start = num(p.time?.created);
    if (start === null) continue;
    const stop = num(p.time?.completed) ?? nowMs;
    ms += Math.max(0, Math.min(stop, to) - Math.max(start, from));
  }
  return ms;
}

// Generation milliseconds of one message: wall span minus overlapped tool
// waits. Without the subtraction a long grep nested in the span drags the
// rate down exactly like the old whole-turn average did.
export function netGenMs(msg: MsgLike, nowMs: number): number | null {
  const created = num(msg.time?.created);
  if (created === null) return null;
  const end = num(msg.time?.completed) ?? nowMs;
  return Math.max(0, Math.max(0, end - created) - toolOverlapMs(msg, created, end, nowMs));
}

function reportedTokens(msg: MsgLike): number | null {
  const out = num(msg.tokens?.output);
  return out === null ? null : out + (num(msg.tokens?.reasoning) ?? 0);
}

export function aggregate(
  assistantMessages: MsgLike[],
  nowMs: number,
): { tokens: number; genSec: number; avgRate: number | null } {
  let tokens = 0;
  let genMs = 0;
  for (const msg of assistantMessages) {
    if (msg?.type !== "assistant") continue;
    const reported = reportedTokens(msg);
    if (reported !== null) tokens += reported;
    genMs += netGenMs(msg, nowMs) ?? 0;
  }
  const genSec = genMs / 1000;
  return {
    tokens,
    genSec,
    avgRate: tokens > 0 ? calcTps(tokens, Math.max(MIN_SPAN_SEC, genSec)) : null,
  };
}

// The current turn's messages: everything after the last prompt.
export function turnMessages(messages: MsgLike[]): MsgLike[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.type === "user") return messages.slice(i + 1);
  }
  return messages;
}

// Tool-execution seconds: wall time the turn spent waiting on tool calls
// instead of generating. Completed calls only — an in-flight wait is not yet
// known, which is what holds the rate steady until the call returns.
export function toolSec(messages: MsgLike[]): number {
  let ms = 0;
  for (const msg of messages) {
    if (msg?.type !== "assistant" || !Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      const p = part as { type?: unknown; time?: { created?: unknown; completed?: unknown } };
      if (p?.type !== "tool") continue;
      const created = num(p.time?.created);
      const completed = num(p.time?.completed);
      if (created !== null && completed !== null) ms += Math.max(0, completed - created);
    }
  }
  return ms / 1000;
}

// Turn rate for the footer: generated tokens over net generation seconds
// (tool waits excluded, including waits nested inside a message span).
// Only the recent RATE_WINDOW_SEC counts: each message's tokens are
// apportioned uniformly over its span, so stale slow output can't drag down
// fresh fast output. Reported usage wins; the in-flight step is estimated
// from streamed chars so the meter still ticks. When nothing generated
// inside the window (e.g. mid tool stall) it falls back to the turn average
// so the number holds steady instead of blanking.
export function turnRate(turn: MsgLike[], nowMs: number): number | null {
  const winStart = nowMs - RATE_WINDOW_SEC * 1000;
  let winTokens = 0;
  let winSec = 0;
  let cumTokens = 0;
  let cumMs = 0;
  for (const msg of turn) {
    if (msg?.type !== "assistant") continue;
    const created = num(msg.time?.created);
    if (created === null) continue;
    const completed = num(msg.time?.completed);
    const end = completed ?? nowMs;
    const span = end - created;
    const reported = completed !== null ? reportedTokens(msg) : null;
    const tokens = reported ?? (completed === null ? estimateTokens(msg) : 0);
    cumTokens += tokens;
    cumMs += netGenMs(msg, nowMs) ?? 0;
    if (span <= 0) {
      if (end >= winStart) winTokens += tokens;
      continue;
    }
    const overlap = Math.min(end, nowMs) - Math.max(created, winStart);
    if (overlap <= 0) continue;
    winTokens += tokens * (overlap / span);
    winSec += Math.max(0, overlap - toolOverlapMs(msg, Math.max(created, winStart), Math.min(end, nowMs), nowMs)) / 1000;
  }
  if (winTokens > 0) return calcTps(winTokens, Math.max(MIN_SPAN_SEC, winSec));
  if (cumTokens > 0) return calcTps(cumTokens, Math.max(MIN_SPAN_SEC, cumMs / 1000));
  return null;
}

// Latest completion time among the turn's assistant messages, `nowMs` while any
// assistant is still in flight, or `nowMs` when the turn has no assistant yet.
// Anchors the finished-turn wall time without relying on component state
// (which a remount would lose).
export function turnEnd(turn: MsgLike[], nowMs: number): number {
  let end = 0;
  for (const msg of turn) {
    if (msg?.type !== "assistant") continue;
    const completed = num(msg.time?.completed);
    if (completed === null) return nowMs;
    if (completed > end) end = completed;
  }
  return end > 0 ? end : nowMs;
}

export function sessionRun(ctx: Context, sessionID: string, nowMs: number): RunStats {
  const messages = readMessages(ctx, sessionID);
  const assistants = messages.filter((msg) => msg?.type === "assistant");
  const { tokens, genSec, avgRate } = aggregate(assistants, nowMs);
  const running = readStatus(ctx, sessionID) === "running";
  // Running rows show the live turn rate; finished rows freeze on the run
  // average (session tokens over session generation seconds). Mixing a
  // last-turn rate with session totals made multi-turn rows disagree with
  // themselves, so each state uses the scope that matches its totals.
  const turn = turnMessages(messages);
  const rate = running ? turnRate(turn, nowMs) : avgRate;
  return { running, rate, genSec, tokens };
}
