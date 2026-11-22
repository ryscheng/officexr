import { beforeEach, describe, expect, it } from 'vitest';
import { clearHintFlags, hintShowCount, isHintAvailable, markHintDone, recordHintShown, resetHintSession, type HintFlagStorage } from './hintFlags';

const memoryStorage = (): HintFlagStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
};

const blockedStorage: HintFlagStorage = {
  length: 0,
  key: () => null,
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

beforeEach(resetHintSession);

describe('hint seen flags', () => {
  it('counts each showing under the officexr:hint: prefix', () => {
    const storage = memoryStorage();
    expect(hintShowCount('move', storage)).toBe(0);
    recordHintShown('move', storage);
    expect(storage.data.get('officexr:hint:move')).toBe('1');
    resetHintSession();
    recordHintShown('move', storage);
    expect(storage.data.get('officexr:hint:move')).toBe('2');
  });

  it('allows a hint twice across visits and then never again', () => {
    const storage = memoryStorage();
    expect(isHintAvailable('people', storage)).toBe(true);
    recordHintShown('people', storage);
    resetHintSession();
    expect(isHintAvailable('people', storage)).toBe(true);
    recordHintShown('people', storage);
    resetHintSession();
    expect(isHintAvailable('people', storage)).toBe(false);
  });

  it('shows a hint at most once per visit', () => {
    const storage = memoryStorage();
    recordHintShown('alone', storage);
    expect(isHintAvailable('alone', storage)).toBe(false);
  });

  it('stops a hint for good once the person did the action', () => {
    const storage = memoryStorage();
    markHintDone('alone', storage);
    resetHintSession();
    expect(storage.data.get('officexr:hint:alone')).toBe('done');
    expect(isHintAvailable('alone', storage)).toBe(false);
  });

  it('shows a hint once per session when storage throws, without an error', () => {
    expect(() => recordHintShown('move', blockedStorage)).not.toThrow();
    expect(hintShowCount('move', blockedStorage)).toBe(0);
    expect(isHintAvailable('move', blockedStorage)).toBe(false);
    expect(isHintAvailable('build', blockedStorage)).toBe(true);
    expect(() => markHintDone('build', blockedStorage)).not.toThrow();
    expect(isHintAvailable('build', blockedStorage)).toBe(false);
  });

  it('treats an unreadable value as not seen', () => {
    const storage = memoryStorage();
    storage.data.set('officexr:hint:move', 'garbage');
    expect(hintShowCount('move', storage)).toBe(0);
  });

  it('clears every flag and the session memory, and nothing else', () => {
    const storage = memoryStorage();
    storage.setItem('officexr:fold:missions', 'open');
    markHintDone('move', storage);
    recordHintShown('alone', storage);
    clearHintFlags(storage);
    expect([...storage.data.keys()]).toEqual(['officexr:fold:missions']);
    expect(isHintAvailable('move', storage)).toBe(true);
    expect(isHintAvailable('alone', storage)).toBe(true);
  });
});
