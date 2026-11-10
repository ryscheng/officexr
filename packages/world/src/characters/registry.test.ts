import { describe, expect, it } from 'vitest';
import {
  CHARACTERS,
  catalogCharacters,
  characterOptions,
  characterUrl,
  isKnownCharacter,
  pickCharacterForPlayer,
  resolvePlayerModel,
} from './registry.ts';

const kind = (id: string, category: string, label = id) => ({ id, label, gltfPath: `/models/packs/${id}.glb`, category } as const);
const NECRO = 'kaykit-skeletons/characters/gltf/Necromancer';
const catalog = catalogCharacters([
  kind(NECRO, 'character', 'Necromancer'),
  kind('kaykit-skeletons/assets/gltf/Skeleton_Axe', 'prop'),
  kind('Mage', 'character', 'Shadow Mage'),
  kind('kaykit-adventurers/Characters/gltf/Druid', 'character', 'Druid'),
]);

describe('catalogCharacters', () => {
  it('offers only character kinds, never shadowing a built-in', () => {
    expect([...catalog.keys()]).toEqual([NECRO, 'kaykit-adventurers/Characters/gltf/Druid']);
    expect(catalog.get(NECRO)).toEqual({ id: NECRO, label: 'Necromancer', url: `/models/packs/${NECRO}.glb` });
  });

  it('lists the built-ins first, then the catalog by label', () => {
    expect(characterOptions(catalog).map((c) => c.label)).toEqual([...CHARACTERS.map((c) => c.replace('_', ' ')), 'Druid', 'Necromancer']);
  });

  it('knows built-ins and catalog characters, but not other catalog kinds', () => {
    expect(isKnownCharacter('Mage')).toBe(true);
    expect(isKnownCharacter(NECRO)).toBe(false);
    expect(isKnownCharacter(NECRO, catalog)).toBe(true);
    expect(isKnownCharacter('kaykit-skeletons/assets/gltf/Skeleton_Axe', catalog)).toBe(false);
    expect(isKnownCharacter(42, catalog)).toBe(false);
  });
});

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

  it('uses a catalog character, and falls back to the hashed built-in until the catalog has it', () => {
    expect(pickCharacterForPlayer('alice@example.com', NECRO, catalog)).toBe(NECRO);
    expect(pickCharacterForPlayer('alice@example.com', NECRO)).toBe(pickCharacterForPlayer('alice@example.com'));
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

  it('renders a catalog character, falling back to the hashed built-in if its GLB fails', () => {
    const hashed = characterUrl(pickCharacterForPlayer('a') as (typeof CHARACTERS)[number]);
    expect(resolvePlayerModel('a', { model: NECRO }, ghostAvatar, catalog)).toEqual({
      url: `/models/packs/${NECRO}.glb`,
      ghost: false,
      fallbackUrl: hashed,
    });
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
