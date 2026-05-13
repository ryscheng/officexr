import type { CharacterConfigs, Vec3, WorldMap } from '@officexr/sdk';
import {
  emptyDocument,
  newPlaceCube,
  type RoomDocument,
  type RoomGroup,
  type SceneCommand,
  type SceneDocument,
} from './commands.ts';
import type { MapDocumentV1 } from './map-document.ts';

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

/**
 * v3 — the new Room document. Spawn points and character configs have
 * been promoted out of the room and onto the parent `MapDocumentV1`.
 * Groups are now first-class document state.
 */
export type SerializedRoomV3 = {
  schemaVersion: 3;
  name: string;
  title?: string;
  updatedAt?: number;
  commands: SceneCommand[];
  groups: Record<string, RoomGroup>;
};

export type SerializedScene =
  | SerializedSceneV1
  | SerializedSceneV2
  | SerializedRoomV3;

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

// --- v3 (Room) helpers -----------------------------------------

export interface SerializeRoomInput {
  name: string;
  title?: string;
  commands: SceneCommand[];
  groups?: Record<string, RoomGroup>;
}

export function serializeRoom(input: SerializeRoomInput): SerializedRoomV3 {
  return {
    schemaVersion: 3,
    name: input.name,
    title: input.title,
    updatedAt: Date.now(),
    commands: input.commands,
    groups: input.groups ?? {},
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
    case 3:
      if (!Array.isArray(obj.commands)) {
        throw new Error('room v3: missing `commands` array');
      }
      if (!obj.groups || typeof obj.groups !== 'object') {
        throw new Error('room v3: missing `groups` object');
      }
      return obj as unknown as SerializedRoomV3;
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
  if (scene.schemaVersion === 3) {
    // v3 → v2 is a structural downgrade: drop the `groups` field. The
    // Scenes (v2) editor doesn't know about groups, so we just lose
    // that metadata; the underlying command list is identical.
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

/**
 * Promote any deserialized scene to a v3 `RoomDocument` the new Room
 * editor can work on.
 *
 * - v3 inputs pass through unchanged.
 * - v2 inputs drop `spawnPoints` and `characterConfigs` (those now
 *   live on the parent `MapDocumentV1`) and gain an empty `groups`
 *   map.
 * - v1 inputs are first migrated to v2 (`migrateToV2`) and then to
 *   v3, so any old `worldMap` cell grid produces a clean v3 doc.
 *
 * Note: shares the input's `commands` array and `groups` object by
 * reference (mirrors the existing `migrateToV2` convention). Callers
 * that intend to mutate the result must clone first.
 */
export function migrateToV3(scene: SerializedScene): RoomDocument {
  if (scene.schemaVersion === 3) {
    return {
      schemaVersion: 3,
      name: scene.name,
      title: scene.title,
      updatedAt: scene.updatedAt,
      commands: scene.commands,
      groups: scene.groups,
    };
  }
  if (scene.schemaVersion === 2) {
    return {
      schemaVersion: 3,
      name: scene.name,
      title: scene.title,
      updatedAt: scene.updatedAt,
      commands: scene.commands,
      groups: {},
    };
  }
  // v1 path: migrate up through v2 so the cell-grid → placeCube emit
  // logic stays in one place.
  const v2 = migrateToV2(scene);
  return {
    schemaVersion: 3,
    name: v2.name,
    title: v2.title,
    updatedAt: v2.updatedAt,
    commands: v2.commands,
    groups: {},
  };
}

// --- Map (v1) helpers ------------------------------------------

export interface SerializeMapInput {
  name: string;
  title?: string;
  rooms: MapDocumentV1['rooms'];
  spawnPoints: MapDocumentV1['spawnPoints'];
  environment: MapDocumentV1['environment'];
}

export function serializeMap(input: SerializeMapInput): MapDocumentV1 {
  return {
    schemaVersion: 1,
    name: input.name,
    title: input.title,
    updatedAt: Date.now(),
    rooms: input.rooms,
    spawnPoints: input.spawnPoints,
    environment: input.environment,
  };
}

/**
 * Validate + parse a map document. Throws on shape errors so the
 * loader can surface the failure (corrupt file / wrong version) to
 * the user instead of silently rendering an empty world.
 */
export function deserializeMap(raw: unknown): MapDocumentV1 {
  if (!raw || typeof raw !== 'object') {
    throw new Error('map: not an object');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.name !== 'string') {
    throw new Error('map: missing string `name`');
  }
  if (obj.schemaVersion !== 1) {
    throw new Error(
      `map: unsupported schemaVersion ${String(obj.schemaVersion)}`,
    );
  }
  if (!Array.isArray(obj.rooms)) {
    throw new Error('map v1: missing `rooms` array');
  }
  if (!Array.isArray(obj.spawnPoints)) {
    throw new Error('map v1: missing `spawnPoints` array');
  }
  if (!obj.environment || typeof obj.environment !== 'object') {
    throw new Error('map v1: missing `environment` object');
  }
  return obj as unknown as MapDocumentV1;
}

