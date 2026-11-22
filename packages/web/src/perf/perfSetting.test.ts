import { afterEach, describe, expect, it, vi } from 'vitest';
import { setShowPerformance, storedShowPerformance } from './perfSetting';

const memory = () => {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
};

afterEach(() => vi.restoreAllMocks());

describe('show performance setting', () => {
  it('is off until switched on, and remembers the choice', () => {
    const storage = memory();
    expect(storedShowPerformance(storage)).toBe(false);
    setShowPerformance(true, storage);
    expect(storedShowPerformance(storage)).toBe(true);
    setShowPerformance(false, storage);
    expect(storedShowPerformance(storage)).toBe(false);
  });

  it('is off, and does not throw, where storage throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(storedShowPerformance(broken)).toBe(false);
    expect(() => setShowPerformance(true, broken)).not.toThrow();
    setShowPerformance(false, memory());
  });
});
