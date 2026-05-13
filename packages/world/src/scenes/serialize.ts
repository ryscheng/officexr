import type { CharacterConfigs, Vec3, WorldMap } from '@officexr/sdk';
import {
  emptyDocument,
  newPlaceCube,
  type SceneCommand,
  type SceneDocument,
} from './commands.ts';

/**
 * On-disk shape: a discriminated union over `schemaVersion`.
 *
 *  - **v1** is the legacy `WorldMap`-based format produced by the
 *    original SceneMode (cell painter). Loaders auto-migrate v1
 *    documents to v2 by emitting one `placeCube` per cell so the new
 *    Scenes mode can keep editing them.
 *  - **v2** is the current command-list format produced by the new
 *    CAD-style editor.
 *
 * `deserializeScene` returns either; callers either call
 * `migrateToV2` or check `schemaVersion` themselves before consuming.
 */
export type SerializedSceneV1 = {
  schemaVersion: 1;
  name: string;
  title?: string;
  updatedAt?: number;
  worldMap: WorldMap;
  spawnPoints: Vec3[];
  characterConfigs?: CharacterConfigs;
};

export type SerializedSceneV2 = {
  schemaVersion: 2;
  name: string;
  title?: string;
  updatedAt?: number;
  /** Command list — same shape as `SceneDocument.commands`. */
  commands: SceneCommand[];
  /** Optional spawn points; the new editor doesn't author these yet
   * but persistence keeps the slot for future scene-mode features. */
  spawnPoints?: Vec3[];
  /** Optional per-character tuning saved alongside the scene. Same
   * meaning as v1. */
  characterConfigs?: CharacterConfigs;
};

export type SerializedScene = SerializedSceneV1 | SerializedSceneV2;

// --- v2 (default) helpers --------------------------------------

export interface SerializeV2Input {
  name: string;
  title?: string;
  commands: SceneCommand[];
  spawnPoints?: Vec3[];
  characterConfigs?: CharacterConfigs;
}

export function serializeScene(input: SerializeV2Input): SerializedSceneV2 {
  return {
    schemaVersion: 2,
    name: input.name,
    title: input.title,
    updatedAt: Date.now(),
    commands: input.commands,
    spawnPoints: input.spawnPoints,
    characterConfigs: input.characterConfigs,
  };
}

// --- v1 helpers (legacy; kept for backwards compat) ------------

export interface SerializeV1Input {
  name: string;
  title?: string;
  worldMap: WorldMap;
  spawnPoints?: Vec3[];
  characterConfigs?: CharacterConfigs;
}

export function serializeSceneV1(input: SerializeV1Input): SerializedSceneV1 {
  return {
    schemaVersion: 1,
    name: input.name,
    title: input.title,
    updatedAt: Date.now(),
    worldMap: input.worldMap,
    spawnPoints: input.spawnPoints ?? [{ x: 0, y: 0, z: 0 }],
    characterConfigs: input.characterConfigs,
  };
}

// --- Deserialize + version sniffing -----------------------------

/**
 * Validates structure + schemaVersion and returns the parsed scene.
 * Throws on validation failure so the caller can surface the error
 * to the user (corrupt or wrong-version file).
 */
export function deserializeScene(raw: unknown): SerializedScene {
  if (!raw || typeof raw !== 'object') {
    throw new Error('scene: not an object');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.name !== 'string') {
    throw new Error('scene: missing string `name`');
  }
  switch (obj.schemaVersion) {
    case 1:
      if (!obj.worldMap || typeof obj.worldMap !== 'object') {
        throw new Error('scene v1: missing `worldMap`');
      }
      if (!Array.isArray(obj.spawnPoints)) {
        throw new Error('scene v1: missing `spawnPoints` array');
      }
      return obj as unknown as SerializedSceneV1;
    case 2:
      if (!Array.isArray(obj.commands)) {
        throw new Error('scene v2: missing `commands` array');
      }
      return obj as unknown as SerializedSceneV2;
    default:
      throw new Error(
        `scene: unsupported schemaVersion ${String(obj.schemaVersion)}`,
      );
  }
}

/**
 * Promote any deserialized scene to a v2 `SceneDocument` the new
 * editor can work on. v2 inputs return as-is (with their command list
 * unwrapped); v1 inputs are migrated by emitting one `placeCube` per
 * cell from each layer.
 *
 * The migration captures the cell's kind id but not its visual color
 * (v1's `CubeKind.appearance` is renderer-side metadata, not part of
 * the new authoring vocabulary). The cell's `(i, j)` is mapped to
 * `(i, 0, j)` voxel coords — y=0 because v1 was XZ-only.
 */
export function migrateToV2(scene: SerializedScene): SceneDocument {
  if (scene.schemaVersion === 2) {
    return {
      schemaVersion: 2,
      name: scene.name,
      title: scene.title,
      updatedAt: scene.updatedAt,
      commands: scene.commands,
    };
  }
  const doc = emptyDocument(scene.name, scene.title);
  doc.updatedAt = scene.updatedAt;
  for (const layer of scene.worldMap.layers) {
    for (const cell of layer.cells) {
      doc.commands.push(
        newPlaceCube({ kindId: layer.kind, position: [cell.i, 0, cell.j] }),
      );
    }
  }
  return doc;
}
