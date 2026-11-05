import { describe, expect, it } from 'vitest';
import { shouldShowNameTag } from './PlayerNameTag.tsx';

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
