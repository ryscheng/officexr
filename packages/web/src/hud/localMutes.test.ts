import { describe, expect, it, vi } from 'vitest';
import { createLocalMutes, type MuteStorage } from './localMutes';

const memory = (initial?: string): MuteStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>(initial === undefined ? [] : [['officexr:muted-people', initial]]);
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe('createLocalMutes', () => {
  it('toggles a login on and off and tells subscribers', () => {
    const mutes = createLocalMutes(memory());
    const listener = vi.fn();
    mutes.subscribe(listener);
    mutes.toggle('ann@example.test');
    expect([...mutes.get()]).toEqual(['ann@example.test']);
    mutes.toggle('ann@example.test');
    expect(mutes.get().size).toBe(0);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('keeps the same set until something changes, and a new set after', () => {
    const mutes = createLocalMutes(memory());
    const before = mutes.get();
    expect(mutes.get()).toBe(before);
    mutes.toggle('a');
    expect(mutes.get()).not.toBe(before);
    expect(before.size).toBe(0);
  });

  it('saves to storage and restores from it', () => {
    const storage = memory();
    createLocalMutes(storage).toggle('ann@example.test');
    expect([...createLocalMutes(storage).get()]).toEqual(['ann@example.test']);
  });

  it('ignores corrupt or wrongly shaped saved data', () => {
    expect(createLocalMutes(memory('not json')).get().size).toBe(0);
    expect(createLocalMutes(memory('{"a":1}')).get().size).toBe(0);
    expect([...createLocalMutes(memory('["a",3,null]')).get()]).toEqual(['a']);
  });

  it('still mutes for the visit when storage refuses writes or is missing', () => {
    const refusing: MuteStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const mutes = createLocalMutes(refusing);
    mutes.toggle('a');
    expect([...mutes.get()]).toEqual(['a']);
    const none = createLocalMutes(null);
    none.toggle('b');
    expect([...none.get()]).toEqual(['b']);
  });

  it('stops notifying an unsubscribed listener', () => {
    const mutes = createLocalMutes(null);
    const listener = vi.fn();
    mutes.subscribe(listener)();
    mutes.toggle('a');
    expect(listener).not.toHaveBeenCalled();
  });
});
