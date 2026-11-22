export interface ModeStats {
  frames: number;
  p50: number;
  p95: number;
  low1Fps: number;
  stalls: number;
  drawCalls: number;
  triangles: number;
}

export const STALL_MS = (1000 / 60) * 2;

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

export function summarizeFrames(deltasMs: readonly number[], drawCalls: number, triangles: number): ModeStats {
  const sorted = [...deltasMs].sort((a, b) => a - b);
  const p99 = percentile(sorted, 0.99);
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    frames: sorted.length,
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    low1Fps: p99 > 0 ? round(1000 / p99) : 0,
    stalls: sorted.filter((d) => d > STALL_MS).length,
    drawCalls,
    triangles,
  };
}
