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

export function readLastAssistant(messages: MsgLike[]): MsgLike | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.type === "assistant") return messages[i];
  }
  return null;
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

export function sessionRun(ctx: Context, sessionID: string, nowMs: number): RunStats {
  const messages = readMessages(ctx, sessionID);
  const assistants = messages.filter((msg) => msg?.type === "assistant");
  const { tokens, genSec, avgRate } = aggregate(assistants, nowMs);
  const running = readStatus(ctx, sessionID) === "running";
  const last = readLastAssistant(messages);
  // Running: live per-step rate so the row moves; frozen run average between
  // steps and once done.
  const rate = running && last ? (messageRate(last, nowMs) ?? avgRate) : avgRate;
  return { running, rate, genSec, tokens };
}
