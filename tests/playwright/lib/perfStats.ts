export interface PhaseSample {
  frames: number;
  wallMs: number;
  scriptMs: number;
  taskMs: number;
  commits: number;
  draws: number;
  tris: number;
}

export interface ModeStats {
  frames: number;
  fps: number;
  scriptMsPerFrame: number;
  taskMsPerFrame: number;
  commitsPerSec: number;
  drawCalls: number;
  triangles: number;
  phases: Record<string, PhaseSample>;
}

const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;

export function summarizeMode(phases: Record<string, PhaseSample>): ModeStats {
  const all = Object.values(phases);
  const sum = (pick: (p: PhaseSample) => number) => all.reduce((total, p) => total + pick(p), 0);
  const frames = Math.max(1, sum((p) => p.frames));
  const wallMs = Math.max(1, sum((p) => p.wallMs));
  return {
    frames,
    fps: round((frames * 1000) / wallMs),
    scriptMsPerFrame: round(sum((p) => p.scriptMs) / frames, 2),
    taskMsPerFrame: round(sum((p) => p.taskMs) / frames, 2),
    commitsPerSec: round((sum((p) => p.commits) * 1000) / wallMs),
    drawCalls: Math.round(sum((p) => p.draws) / frames),
    triangles: Math.round(sum((p) => p.tris) / frames),
    phases,
  };
}
