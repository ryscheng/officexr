import { describe, expect, it } from 'vitest';
import { CHARACTERS, characterUrl, pickCharacterForPlayer, resolvePlayerModel } from './registry.ts';

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

describe('resolvePlayerModel', () => {
  const own = characterUrl('Mage');
  const ghostAvatar = { model: '/models/characters/Ghost.glb' };

  it('renders 3d and unset view modes as the opaque character', () => {
    expect(resolvePlayerModel('a', { model: 'Mage' }, ghostAvatar)).toEqual({ url: own, ghost: false, fallbackUrl: own });
    expect(resolvePlayerModel('a', { model: 'Mage', viewMode: '3d' }, ghostAvatar)).toEqual({ url: own, ghost: false, fallbackUrl: own });
  });

  it('renders 2d players with the ghost GLB, falling back to their character', () => {
    expect(resolvePlayerModel('a', { model: 'Mage', viewMode: '2d' }, ghostAvatar)).toEqual({
      url: ghostAvatar.model,
      ghost: true,
      fallbackUrl: own,
    });
  });

  it('renders 2d players as a ghost of a per-id character, ignoring their model, when the world has no ghost GLB', () => {
    const asMage = resolvePlayerModel('a', { model: 'Mage', viewMode: '2d' }, undefined);
    expect(CHARACTERS.map(characterUrl)).toContain(asMage.url);
    expect(asMage).toMatchObject({ ghost: true, fallbackUrl: own });
    expect(resolvePlayerModel('a', { model: 'Knight', viewMode: '2d' }, undefined).url).toBe(asMage.url);
    expect(resolvePlayerModel('a', { model: 'Mage', viewMode: '2d' }, undefined)).toEqual(asMage);
  });
});
