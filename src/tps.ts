// Pure TPS math + formatting. No OpenCode imports, so it stays unit-testable.

export function calcTps(tokens: number, elapsedSec: number): number | null {
  if (!Number.isFinite(tokens) || !Number.isFinite(elapsedSec)) return null;
  if (elapsedSec <= 0 || tokens < 0) return null;
  return tokens / elapsedSec;
}

export function formatLine(tps: number | null, elapsedSec: number): string {
  const left = tps === null ? "—" : tps.toFixed(1);
  const right =
    Number.isFinite(elapsedSec) && elapsedSec >= 0 ? elapsedSec.toFixed(1) : "—";
  return `${left} t/s | ${right} s`;
}
