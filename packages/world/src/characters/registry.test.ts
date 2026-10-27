import { describe, expect, it } from 'vitest';
import { CHARACTERS, pickCharacterForPlayer } from './registry.ts';

describe('pickCharacterForPlayer', () => {
  it('uses the player model when it names a character', () => {
    expect(pickCharacterForPlayer('alice@example.com', 'Mage')).toBe('Mage');
  });

  it('falls back deterministically for a player with no valid model', () => {
    const picked = pickCharacterForPlayer('alice@example.com');
    expect(CHARACTERS).toContain(picked);
    expect(pickCharacterForPlayer('alice@example.com', 'default')).toBe(picked);
    expect(pickCharacterForPlayer('alice@example.com')).toBe(picked);
  });

  it('spreads fallbacks across characters', () => {
    const picks = new Set(Array.from({ length: 50 }, (_, i) => pickCharacterForPlayer(`user-${i}`)));
    expect(picks.size).toBeGreaterThan(1);
  });
});
