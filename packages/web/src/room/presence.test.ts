import { describe, expect, it } from 'vitest';
import { micState, presenceStatus } from './presence';

describe('presenceStatus', () => {
  it.each([
    [{ hidden: false, focused: true }, 'available'],
    [{ hidden: true, focused: true }, 'away'],
    [{ hidden: false, focused: false }, 'away'],
    [{ hidden: true, focused: false }, 'away'],
  ] as const)('%j is %s', (input, expected) => {
    expect(presenceStatus(input)).toBe(expected);
  });
});

describe('micState', () => {
  it.each([
    [{ inCall: false, muted: false, speaking: false }, 'none'],
    [{ inCall: false, muted: true, speaking: true }, 'none'],
    [{ inCall: true, muted: true, speaking: true }, 'muted'],
    [{ inCall: true, muted: false, speaking: true }, 'speaking'],
    [{ inCall: true, muted: false, speaking: false }, 'silent'],
  ] as const)('%j is %s', (input, expected) => {
    expect(micState(input)).toBe(expected);
  });
});
