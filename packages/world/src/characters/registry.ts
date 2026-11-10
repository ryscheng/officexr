import type { AvatarData, CharacterConfig, CharacterConfigs, WorldConstants } from '@officexr/sdk';
import { modelUrl } from '../app/asset-url.ts';
import type { WorldObjectKind } from '../scenes/world-object-kinds-schema.ts';

/**
 * Built-in character models bundled with the world package. Each id
 * resolves to a GLB at `/models/characters/{id}.glb` plus the shared
 * animation rig under `/models/animations/`. These are the base set that
 * works without a catalog; every catalog kind in the `character`
 * category is offered on top of them (see {@link catalogCharacters}).
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

/** A model a player can pick: a built-in character, or a catalog kind in the `character` category. */
export interface CharacterOption {
  /** What `avatar.model` stores: the built-in name, or the catalog kind id. */
  id: string;
  label: string;
  url: string;
}

/** Catalog characters by id, as {@link catalogCharacters} builds them. */
export type CatalogCharacters = ReadonlyMap<string, CharacterOption>;

const NO_CATALOG_CHARACTERS: CatalogCharacters = new Map();

export function isCharacterName(value: unknown): value is CharacterName {
  return (CHARACTERS as readonly unknown[]).includes(value);
}

export const characterUrl = (character: CharacterName) => modelUrl(`/models/characters/${character}.glb`);

export const BASE_CHARACTER_OPTIONS: readonly CharacterOption[] = CHARACTERS.map((name) => ({
  id: name,
  label: name.replace(/_/g, ' '),
  url: characterUrl(name),
}));

/** The catalog's `character` kinds as pickable characters. A kind whose id is a built-in name is left out, so it can't shadow that built-in. */
export function catalogCharacters(
  kinds: Iterable<Pick<WorldObjectKind, 'id' | 'label' | 'gltfPath' | 'category'>>,
): CatalogCharacters {
  const out = new Map<string, CharacterOption>();
  for (const kind of kinds) {
    if (kind.category === 'character' && !isCharacterName(kind.id)) {
      out.set(kind.id, { id: kind.id, label: kind.label, url: modelUrl(kind.gltfPath) });
    }
  }
  return out;
}

/** `catalog`'s characters, by label. */
export function catalogCharacterOptions(catalog: CatalogCharacters): CharacterOption[] {
  return [...catalog.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Every pickable character: the built-ins first, then the catalog's, by label. */
export function characterOptions(catalog: CatalogCharacters = NO_CATALOG_CHARACTERS): CharacterOption[] {
  return [...BASE_CHARACTER_OPTIONS, ...catalogCharacterOptions(catalog)];
}

/** Whether `value` names a built-in character or one of `catalog`'s. */
export function isKnownCharacter(value: unknown, catalog: CatalogCharacters = NO_CATALOG_CHARACTERS): value is string {
  return isCharacterName(value) || (typeof value === 'string' && catalog.has(value));
}

function hashedCharacter(playerId: string): CharacterName {
  let hash = 0;
  for (let i = 0; i < playerId.length; i++) {
    hash = (hash * 31 + playerId.charCodeAt(i)) >>> 0;
  }
  return CHARACTERS[hash % CHARACTERS.length];
}

/** The character `model` names, else a built-in picked by a stable hash of
 * `playerId` so every peer renders the same fallback. */
export function resolveCharacter(
  playerId: string,
  model?: string,
  catalog: CatalogCharacters = NO_CATALOG_CHARACTERS,
): CharacterOption {
  const fromCatalog = model === undefined ? undefined : catalog.get(model);
  if (fromCatalog) {
    return fromCatalog;
  }
  const name = isCharacterName(model) ? model : hashedCharacter(playerId);
  return BASE_CHARACTER_OPTIONS[CHARACTERS.indexOf(name)];
}

/** The id of {@link resolveCharacter}'s pick. */
export function pickCharacterForPlayer(
  playerId: string,
  model?: string,
  catalog: CatalogCharacters = NO_CATALOG_CHARACTERS,
): string {
  return resolveCharacter(playerId, model, catalog).id;
}

export interface PlayerModel {
  url: string;
  ghost: boolean;
  /** Loaded instead of `url` when it fails: the player's built-in character. */
  fallbackUrl: string;
}

/** 2D-mode players render as ghosts: the world's ghost GLB when set, else a character hashed from their id. */
export function resolvePlayerModel(
  playerId: string,
  avatar: AvatarData,
  ghostAvatar: WorldConstants['ghostAvatar'],
  catalog: CatalogCharacters = NO_CATALOG_CHARACTERS,
): PlayerModel {
  const own = resolveCharacter(playerId, avatar.model, catalog).url;
  const hashed = characterUrl(hashedCharacter(playerId));
  // A catalog character's GLB can go missing; a built-in always ships.
  const builtIn = isCharacterName(avatar.model) ? characterUrl(avatar.model) : hashed;
  if (avatar.viewMode !== '2d') {
    return { url: own, ghost: false, fallbackUrl: builtIn };
  }
  if (ghostAvatar) {
    return { url: modelUrl(ghostAvatar.model), ghost: true, fallbackUrl: builtIn };
  }
  // ponytail: a hashed stand-in character until a ghost GLB exists in GHOST_MODELS.
  return { url: hashed, ghost: true, fallbackUrl: builtIn };
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
