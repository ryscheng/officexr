import type { AvatarData, CharacterConfig, CharacterConfigs, WorldConstants } from '@officexr/sdk';
import { modelUrl } from '../app/asset-url.ts';

/**
 * Built-in character models bundled with the world package. Each id
 * resolves to a GLB at `/models/characters/{id}.glb` plus the shared
 * animation rig under `/models/animations/`.
 *
 * Studio's CharacterMode reads this array to populate its model
 * selector; the renderer's `Adventurer` component reads the GLB
 * keyed off `PlayerState.avatar.model`. Adding a new model is a
 * new entry here plus its GLB on disk — no other code change required.
 */
export const CHARACTERS = [
  'Barbarian',
  'Knight',
  'Mage',
  'Ranger',
  'Rogue',
  'Rogue_Hooded',
] as const;

/** World-wide models shown for 2D users. Kept apart from `CHARACTERS` so they
 * never reach the player character picker. */
export const GHOST_MODELS: readonly { id: string; label: string; url: string }[] = [];

export type CharacterName = (typeof CHARACTERS)[number];

export function isCharacterName(value: unknown): value is CharacterName {
  return (CHARACTERS as readonly unknown[]).includes(value);
}

/** `model` when it names a built-in character, else one picked by a stable
 * hash of `playerId` so every peer renders the same fallback. */
export function pickCharacterForPlayer(
  playerId: string,
  model?: string,
): CharacterName {
  if (isCharacterName(model)) {
    return model;
  }
  let hash = 0;
  for (let i = 0; i < playerId.length; i++) {
    hash = (hash * 31 + playerId.charCodeAt(i)) >>> 0;
  }
  return CHARACTERS[hash % CHARACTERS.length];
}

export const characterUrl = (character: CharacterName) => modelUrl(`/models/characters/${character}.glb`);

export interface PlayerModel {
  url: string;
  ghost: boolean;
  /** Loaded instead of `url` when it fails; the player's own character. */
  fallbackUrl: string;
}

/** 2D-mode players render as ghosts: the world's ghost GLB when set, else a character hashed from their id. */
export function resolvePlayerModel(
  playerId: string,
  avatar: AvatarData,
  ghostAvatar: WorldConstants['ghostAvatar'],
): PlayerModel {
  const own = characterUrl(pickCharacterForPlayer(playerId, avatar.model));
  if (avatar.viewMode !== '2d') {
    return { url: own, ghost: false, fallbackUrl: own };
  }
  if (ghostAvatar) {
    return { url: modelUrl(ghostAvatar.model), ghost: true, fallbackUrl: own };
  }
  // ponytail: a hashed stand-in character until a ghost GLB exists in GHOST_MODELS.
  return { url: characterUrl(pickCharacterForPlayer(playerId)), ghost: true, fallbackUrl: own };
}

/**
 * Per-model default overrides. Empty per model means "fall back to
 * `WorldSettings`" — i.e. every character moves at the same speed
 * unless studio (or future authored content) writes a config. Studio's
 * CharacterMode seeds new entries here when a creator first tunes a
 * model.
 *
 * Kept as a separate constant from `CHARACTERS` so a creator can add
 * configs for models that aren't shipped by default (e.g. a custom
 * GLB dropped into `/public/models/`).
 */
export const DEFAULT_CHARACTER_CONFIGS: CharacterConfigs = {};

/**
 * Convenience accessor — returns an empty config when the model has
 * none, so callers don't have to handle `undefined` themselves.
 */
export function getCharacterConfig(
  configs: CharacterConfigs,
  modelId: string,
): CharacterConfig {
  return configs[modelId] ?? {};
}
