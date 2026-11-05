import { describe, expect, it } from 'vitest';
import { shouldShowNameTag, shouldShowPingBell } from './PlayerNameTag.tsx';

describe('shouldShowNameTag', () => {
  it('shows for another player with a name', () => {
    expect(shouldShowNameTag('Ada', false, false)).toBe(true);
  });
  it('hides for the self player', () => {
    expect(shouldShowNameTag('Ada', true, false)).toBe(false);
  });
  it('hides for an empty name', () => {
    expect(shouldShowNameTag('', false, false)).toBe(false);
  });
  it('hides when paused', () => {
    expect(shouldShowNameTag('Ada', false, true)).toBe(false);
  });
});

describe('shouldShowPingBell', () => {
  const ping = () => {};
  it('shows for another player in the fixed camera', () => {
    expect(shouldShowPingBell(ping, false, 'fixed', false)).toBe(true);
  });
  it('hides for the self player', () => {
    expect(shouldShowPingBell(ping, true, 'fixed', false)).toBe(false);
  });
  it('hides when paused', () => {
    expect(shouldShowPingBell(ping, false, 'fixed', true)).toBe(false);
  });
  it.each(['first-person', 'third-person'] as const)('hides in pointer-lock mode %s', (mode) => {
    expect(shouldShowPingBell(ping, false, mode, false)).toBe(false);
  });
  it('hides without a ping callback', () => {
    expect(shouldShowPingBell(undefined, false, 'fixed', false)).toBe(false);
  });
});
