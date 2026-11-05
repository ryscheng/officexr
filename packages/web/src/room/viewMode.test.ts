import { describe, expect, it, vi } from 'vitest';
import { detectGpu, initialViewMode, storeViewMode } from './viewMode';

function canvasFactory(supported: { webgl2?: 'strict' | 'any'; webgl?: 'strict' | 'any' }, lost: string[] = []) {
  return () => {
    let first: string | undefined;
    return {
      getContext: (type: 'webgl2' | 'webgl', attrs?: WebGLContextAttributes) => {
        first ??= type;
        if (first !== type) {
          return null;
        }
        const need = supported[type];
        if (!need || (need === 'any' && attrs?.failIfMajorPerformanceCaveat)) {
          return null;
        }
        return { getExtension: () => ({ loseContext: () => lost.push(type) }) };
      },
    } as unknown as HTMLCanvasElement;
  };
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

describe('storeViewMode', () => {
  it('ignores a throwing storage', () => {
    expect(() =>
      storeViewMode('2d', {
        setItem: () => {
          throw new Error('blocked');
        },
      }),
    ).not.toThrow();
  });
});

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

describe('initialViewMode', () => {
  it('uses the stored choice without probing', () => {
    const detect = vi.fn(() => 'none' as const);
    expect(initialViewMode(memoryStorage({ 'officexr:viewMode': '3d' }), detect)).toBe('3d');
    expect(detect).not.toHaveBeenCalled();
  });

  it('probes on the first visit and remembers the result', () => {
    const storage = memoryStorage();
    expect(initialViewMode(storage, () => 'hardware')).toBe('3d');
    expect(storage.data['officexr:viewMode']).toBe('3d');
    const detect = vi.fn(() => 'software' as const);
    expect(initialViewMode(storage, detect)).toBe('3d');
    expect(detect).not.toHaveBeenCalled();
  });

  it('starts in 2d without a hardware GPU', () => {
    expect(initialViewMode(memoryStorage(), () => 'software')).toBe('2d');
    expect(initialViewMode(memoryStorage(), () => 'none')).toBe('2d');
  });

  it('probes when storage throws', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(initialViewMode(blocked, () => 'hardware')).toBe('3d');
  });
});
