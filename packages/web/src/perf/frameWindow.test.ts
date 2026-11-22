import { describe, expect, it } from 'vitest';
import { createFrameWindow } from './frameWindow';

const sample = (frameMs: number, worstMs: number) => ({ fps: 1000 / frameMs, frameMs, worstMs, drawCalls: 7, triangles: 90, geometries: 0, textures: 0 });

describe('createFrameWindow', () => {
  it('reports the median of the window and its worst frame', () => {
    const w = createFrameWindow(5000);
    w.push(sample(10, 12), 0);
    w.push(sample(30, 90), 500);
    const summary = w.push(sample(12, 15), 1000);
    expect(summary.medianMs).toBe(12);
    expect(summary.worstMs).toBe(90);
    expect(summary.drawCalls).toBe(7);
  });

  it('forgets samples older than the window', () => {
    const w = createFrameWindow(5000);
    w.push(sample(30, 90), 0);
    const summary = w.push(sample(10, 11), 6000);
    expect(summary.worstMs).toBe(11);
  });
});
