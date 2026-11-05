import { describe, expect, it } from 'vitest';
import { detectGpu, initialViewMode, storedViewMode } from './viewMode';

function canvasFactory(supported: { webgl2?: 'strict' | 'any'; webgl?: 'strict' | 'any' }, lost: string[] = []) {
  return () =>
    ({
      getContext: (type: 'webgl2' | 'webgl', attrs?: WebGLContextAttributes) => {
        const need = supported[type];
        if (!need || (need === 'any' && attrs?.failIfMajorPerformanceCaveat)) {
          return null;
        }
        return { getExtension: () => ({ loseContext: () => lost.push(type) }) };
      },
    }) as unknown as HTMLCanvasElement;
}

describe('detectGpu', () => {
  it('reports hardware when a context survives failIfMajorPerformanceCaveat', () => {
    expect(detectGpu(canvasFactory({ webgl2: 'strict' }))).toBe('hardware');
  });

  it('reports software when only a plain context succeeds', () => {
    expect(detectGpu(canvasFactory({ webgl: 'any' }))).toBe('software');
  });

  it('reports none without WebGL', () => {
    expect(detectGpu(canvasFactory({}))).toBe('none');
  });

  it('discards the probe context', () => {
    const lost: string[] = [];
    detectGpu(canvasFactory({ webgl2: 'strict' }, lost));
    expect(lost).toEqual(['webgl2']);
  });
});

describe('initialViewMode', () => {
  it('prefers the stored choice', () => {
    expect(initialViewMode('hardware', '2d')).toBe('2d');
    expect(initialViewMode('software', '3d')).toBe('3d');
  });

  it('defaults by GPU', () => {
    expect(initialViewMode('hardware', null)).toBe('3d');
    expect(initialViewMode('software', null)).toBe('2d');
  });

  it('is always 2d without WebGL', () => {
    expect(initialViewMode('none', '3d')).toBe('2d');
  });

  it('falls back to detection when storage throws', () => {
    const stored = storedViewMode({
      getItem: () => {
        throw new Error('blocked');
      },
    });
    expect(stored).toBeNull();
    expect(initialViewMode('hardware', stored)).toBe('3d');
  });
});
