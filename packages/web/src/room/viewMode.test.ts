import { describe, expect, it } from 'vitest';
import { initialViewMode, storeViewMode } from './viewMode';

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

describe('initialViewMode', () => {
  it('uses the stored choice', () => {
    expect(initialViewMode(memoryStorage({ 'officexr:viewMode': '2d' }))).toBe('2d');
    expect(initialViewMode(memoryStorage({ 'officexr:viewMode': '3d' }))).toBe('3d');
  });

  it('defaults to 3d without a choice', () => {
    expect(initialViewMode(memoryStorage())).toBe('3d');
    expect(initialViewMode(memoryStorage({ 'officexr:viewMode': 'bogus' }))).toBe('3d');
  });

  it('defaults to 3d when storage throws', () => {
    expect(
      initialViewMode({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toBe('3d');
  });
});
