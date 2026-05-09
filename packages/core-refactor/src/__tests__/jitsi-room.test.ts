import { describe, it, expect } from 'vitest';
import { deriveJitsiRoom } from '../communication/jitsi-room.ts';

describe('deriveJitsiRoom', () => {
  it('returns null when there are no nearby peers', () => {
    expect(deriveJitsiRoom('alice', [])).toBeNull();
    expect(deriveJitsiRoom('alice', new Set())).toBeNull();
  });

  it('returns the lex-min seed of {self, ...nearby} when there is at least one peer', () => {
    expect(deriveJitsiRoom('charlie', ['bob'])).toBe('room-bob');
    expect(deriveJitsiRoom('alice', ['bob'])).toBe('room-alice');
    expect(deriveJitsiRoom('charlie', ['bob', 'alice'])).toBe('room-alice');
  });

  it('is symmetric — same room derived from either side of a pair', () => {
    expect(deriveJitsiRoom('alice', ['bob'])).toBe(deriveJitsiRoom('bob', ['alice']));
  });

  it('ignores self appearing in the nearby set', () => {
    expect(deriveJitsiRoom('alice', ['alice', 'bob'])).toBe('room-alice');
  });

  it('is deterministic regardless of nearby ordering', () => {
    expect(deriveJitsiRoom('zed', ['c', 'a', 'b'])).toBe(deriveJitsiRoom('zed', ['b', 'a', 'c']));
    expect(deriveJitsiRoom('zed', ['c', 'a', 'b'])).toBe('room-a');
  });
});
