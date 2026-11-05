import { describe, expect, it } from 'vitest';
import { shouldShowPingBell } from './PlayerPingBell.tsx';

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
