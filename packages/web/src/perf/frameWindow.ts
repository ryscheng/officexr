import type { FrameStatsSample } from '@officexr/world/renderer';

export const WINDOW_MS = 5000;

export interface FrameSummary {
  fps: number;
  medianMs: number;
  worstMs: number;
  drawCalls: number;
  triangles: number;
}

interface Entry {
  at: number;
  sample: FrameStatsSample;
}

export function createFrameWindow(windowMs = WINDOW_MS) {
  let entries: Entry[] = [];
  return {
    push(sample: FrameStatsSample, now: number): FrameSummary {
      entries.push({ at: now, sample });
      entries = entries.filter((e) => now - e.at <= windowMs);
      const times = entries.map((e) => e.sample.frameMs).sort((a, b) => a - b);
      return {
        fps: sample.fps,
        medianMs: times[Math.floor(times.length / 2)] ?? 0,
        worstMs: Math.max(...entries.map((e) => e.sample.worstMs)),
        drawCalls: sample.drawCalls,
        triangles: sample.triangles,
      };
    },
    clear() {
      entries = [];
    },
  };
}
