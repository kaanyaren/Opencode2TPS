// Shared session measurement for the footer meter and the sidebar list.
// Reads are defensive: a missing/unsynced session must never throw.

import type { Context } from "@opencode/plugin/tui/context";
import { calcTps } from "./tps.ts";

// Chars-per-token for the live estimate before reported usage lands.
// Measured on real traffic: text ~4.7, reasoning ~4.0.
export const CHARS_PER_TOKEN = 4.2;
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

// Streamed text + reasoning characters. Both are generated tokens; counting
// only visible text reads ~0 while the model thinks.
export function charsOf(msg: MsgLike): number {
  if (!Array.isArray(msg.content)) return 0;
  let sum = 0;
  for (const part of msg.content) {
    const p = part as { type?: unknown; text?: unknown };
    if ((p?.type === "text" || p?.type === "reasoning") && typeof p.text === "string") {
      sum += p.text.length;
    }
  }
  return sum;
}

export function readStatus(ctx: Context, sessionID: string): "idle" | "running" {
  try {
    return ctx.data.session.status(sessionID);
  } catch {
    return "idle";
  }
}

export function messageRate(msg: MsgLike, nowMs: number): number | null {
  const created = num(msg.time?.created);
  if (created === null) return null;
  const completed = num(msg.time?.completed);
  const out = num(msg.tokens?.output);
  if (completed !== null && out !== null) {
    const span = Math.max(MIN_SPAN_SEC, (completed - created) / 1000);
    return calcTps(out + (num(msg.tokens?.reasoning) ?? 0), span);
  }
  const chars = charsOf(msg);
  if (chars <= 0) return null;
  const elapsed = Math.max(MIN_SPAN_SEC, (nowMs - created) / 1000);
  return calcTps(chars / CHARS_PER_TOKEN, elapsed);
}

export function aggregate(
  assistantMessages: MsgLike[],
  nowMs: number,
): { tokens: number; genSec: number; avgRate: number | null } {
  let tokens = 0;
  let genMs = 0;
  for (const msg of assistantMessages) {
    if (msg?.type !== "assistant") continue;
    const out = num(msg.tokens?.output);
    if (out !== null) tokens += out + (num(msg.tokens?.reasoning) ?? 0);
    const created = num(msg.time?.created);
    if (created !== null) {
      const end = num(msg.time?.completed) ?? nowMs;
      genMs += Math.max(0, end - created);
    }
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

// Turn rate for the footer: generated tokens over generation + tool-wait
// seconds. Reported usage wins; the in-flight step is estimated from streamed
// chars so the meter still ticks. A tool call's wait lands only once it
// completes, so the number holds through an MCP/shell call and then steps down.
export function turnRate(turn: MsgLike[], nowMs: number): number | null {
  let tokens = 0;
  let genMs = 0;
  let liveChars = 0;
  for (const msg of turn) {
    if (msg?.type !== "assistant") continue;
    const created = num(msg.time?.created);
    const completed = num(msg.time?.completed);
    const out = num(msg.tokens?.output);
    if (out !== null && completed !== null) tokens += out + (num(msg.tokens?.reasoning) ?? 0);
    else if (completed === null) liveChars += charsOf(msg);
    if (created !== null) genMs += Math.max(0, (completed ?? nowMs) - created);
  }
  const total = tokens + liveChars / CHARS_PER_TOKEN;
  if (total <= 0) return null;
  return calcTps(total, Math.max(MIN_SPAN_SEC, genMs / 1000 + toolSec(turn)));
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
  const { tokens, genSec } = aggregate(assistants, nowMs);
  const running = readStatus(ctx, sessionID) === "running";
  // Same rate definition as the footer: this turn's tokens over generation
  // plus completed tool-wait seconds, so the row and footer never disagree.
  const rate = turnRate(turnMessages(messages), nowMs);
  return { running, rate, genSec, tokens };
}
