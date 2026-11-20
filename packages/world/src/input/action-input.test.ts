import { describe, expect, it } from 'vitest';
import { ACTION_KEYS, ActionInput } from './action-input.ts';

describe('ActionInput', () => {
  it('adds the key of a held action to the keyboard keys', () => {
    const input = new ActionInput();
    input.press('jump');
    input.press('sprint');
    const merged = input.mergeInto(new Set(['w']));
    expect([...merged].sort()).toEqual(['w', ACTION_KEYS.jump, ACTION_KEYS.sprint].sort());
  });

  it('returns the keyboard set itself when nothing is held', () => {
    const keys = new Set(['w']);
    expect(new ActionInput().mergeInto(keys)).toBe(keys);
  });

  it('keeps a tap that ended before a frame read it for exactly one frame', () => {
    const input = new ActionInput();
    input.press('poke');
    input.release('poke');
    expect(input.mergeInto(new Set()).has(ACTION_KEYS.poke!)).toBe(true);
    expect(input.mergeInto(new Set()).has(ACTION_KEYS.poke!)).toBe(false);
  });

  it('drops a held action on release and on releaseAll', () => {
    const input = new ActionInput();
    input.press('sprint');
    input.press('jump');
    input.release('sprint');
    expect(input.isDown('sprint')).toBe(false);
    input.releaseAll();
    expect(input.isDown('jump')).toBe(false);
    expect(input.mergeInto(new Set()).size).toBe(0);
  });

  it('ignores actions without a key', () => {
    const input = new ActionInput();
    input.press('unmapped');
    expect(input.mergeInto(new Set()).size).toBe(0);
  });
});
