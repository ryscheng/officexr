import type { CharacterConfig, CharacterConfigs } from '@officexr/sdk';

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

export type CharacterName = (typeof CHARACTERS)[number];

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
