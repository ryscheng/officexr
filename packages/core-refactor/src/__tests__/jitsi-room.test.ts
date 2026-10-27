import { describe, it, expect } from 'vitest';
import { deriveJitsiRoom } from '../communication/jitsi-room.ts';

describe('deriveJitsiRoom', () => {
  it('returns null when there are no nearby peers', () => {
    expect(deriveJitsiRoom('o1', 'alice', [])).toBeNull();
    expect(deriveJitsiRoom('o1', 'alice', new Set())).toBeNull();
  });

  it('returns the lex-min seed of {self, ...nearby} when there is at least one peer', () => {
    expect(deriveJitsiRoom('o1', 'charlie', ['bob'])).toBe('room-o1-bob');
    expect(deriveJitsiRoom('o1', 'alice', ['bob'])).toBe('room-o1-alice');
    expect(deriveJitsiRoom('o1', 'charlie', ['bob', 'alice'])).toBe('room-o1-alice');
  });

  it('is symmetric — same room derived from either side of a pair', () => {
    expect(deriveJitsiRoom('o1', 'alice', ['bob'])).toBe(deriveJitsiRoom('o1', 'bob', ['alice']));
  });

  it('ignores self appearing in the nearby set', () => {
    expect(deriveJitsiRoom('o1', 'alice', ['alice', 'bob'])).toBe('room-o1-alice');
  });

  it('is deterministic regardless of nearby ordering', () => {
    expect(deriveJitsiRoom('o1', 'zed', ['c', 'a', 'b'])).toBe(deriveJitsiRoom('o1', 'zed', ['b', 'a', 'c']));
    expect(deriveJitsiRoom('o1', 'zed', ['c', 'a', 'b'])).toBe('room-o1-a');
  });

  it('differs across offices for the same players', () => {
    expect(deriveJitsiRoom('o1', 'alice', ['bob'])).not.toBe(deriveJitsiRoom('o2', 'alice', ['bob']));
  });
});
