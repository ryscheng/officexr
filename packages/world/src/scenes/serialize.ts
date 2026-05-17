import type { CharacterConfigs, Vec3, WorldMap } from '@officexr/sdk';
import {
  emptyDocument,
  newPlaceCube,
  type PlaceObjectCommand,
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
 * v3 — the legacy Room document. Op string is 'placeCube'; positions
 * are in voxelSize=2 coordinates. Superseded by v4 in task-02.
 * On load, the storage layer calls migrateRoomV3toV4 automatically.
 *
 * Note: the `commands` here use a looser op-string type to accommodate
 * both 'placeCube' and 'placeObject' from partially-migrated files.
 */
export type SerializedRoomV3 = {
  schemaVersion: 3;
  name: string;
  title?: string;
  updatedAt?: number;
  commands: Array<
    | { id: string; op: 'placeCube'; kindId: string; position: [number, number, number] }
    | { id: string; op: 'extrude'; targetCommandId: string; face: string; count: number }
  >;
  groups: Record<string, RoomGroup>;
};

/**
 * v4 — the current Room document. Op string is 'placeObject'; positions
 * are ×4 relative to v3 (coordinate system change from voxelSize=2 to
 * voxelSize=0.5 in task-03). Groups are first-class document state.
 */
export type SerializedRoomV4 = {
  schemaVersion: 4;
  name: string;
  title?: string;
  updatedAt?: number;
  commands: SceneCommand[];
  groups: Record<string, RoomGroup>;
};

export type SerializedScene =
  | SerializedSceneV1
  | SerializedSceneV2
  | SerializedRoomV3
  | SerializedRoomV4;

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

export function serializeRoom(input: SerializeRoomInput): SerializedRoomV4 {
  return {
    schemaVersion: 4,
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
    case 4:
      if (!Array.isArray(obj.commands)) {
        throw new Error('room v4: missing `commands` array');
      }
      if (!obj.groups || typeof obj.groups !== 'object') {
        throw new Error('room v4: missing `groups` object');
      }
      return obj as unknown as SerializedRoomV4;
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
    // Cast required: SerializedRoomV3 uses op:'placeCube' which is a
    // legacy on-disk string. The v2 SceneDocument tolerates this at
    // runtime; a v3 doc in the wild today will be re-migrated to v4
    // by the storage layer before it ever reaches this downgrade path.
    return {
      schemaVersion: 2,
      name: scene.name,
      title: scene.title,
      updatedAt: scene.updatedAt,
      commands: scene.commands as unknown as SceneCommand[],
    };
  }
  if (scene.schemaVersion === 4) {
    // v4 → v2 downgrade: drop groups. Commands are already typed as
    // SceneCommand[] (op:'placeObject'), so no cast needed.
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
  // scene is SerializedSceneV1 here (schemaVersion === 1)
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
 * Promote a v3 SerializedRoomV3 to v4. Pure function — no side effects.
 *
 * Changes in v4:
 *   1. `op: 'placeCube'` → `op: 'placeObject'`
 *   2. `position` on each placeObject command is multiplied by 4 to
 *      preserve world coordinates after voxelSize changes from 2 to 0.5
 *      (task-03). `extrude` commands have no position and pass through.
 *   3. `schemaVersion: 4`
 *
 * Idempotence: this function only accepts v3 input. The caller (storage
 * layer) gates on `schemaVersion === 3` before calling.
 */
export function migrateRoomV3toV4(doc: SerializedRoomV3): SerializedRoomV4 {
  const commands: SceneCommand[] = doc.commands.map((cmd) => {
    if (cmd.op === 'placeCube' || (cmd.op as string) === 'placeObject') {
      // Both 'placeCube' (v3 on-disk) and 'placeObject' (from v2 intermediate)
      // need the ×4 position scale so world coordinates are preserved when
      // voxelSize changes from 2 to 0.5 (task-03).
      const placeCmd = cmd as {
        id: string;
        op: string;
        kindId: string;
        position: [number, number, number];
      };
      const [x, y, z] = placeCmd.position;
      return {
        id: placeCmd.id,
        op: 'placeObject',
        kindId: placeCmd.kindId,
        position: [x * 4, y * 4, z * 4],
      } satisfies PlaceObjectCommand;
    }
    // extrude and any other commands pass through unchanged.
    return cmd as unknown as SceneCommand;
  });
  return {
    schemaVersion: 4,
    name: doc.name,
    title: doc.title,
    updatedAt: doc.updatedAt,
    commands,
    groups: doc.groups,
  };
}

/**
 * Promote any deserialized scene to a v4 `RoomDocument` the new Room
 * editor can work on.
 *
 * - v4 inputs pass through unchanged.
 * - v3 inputs are migrated via migrateRoomV3toV4 (op rewrite + ×4 positions).
 * - v2 inputs are first promoted to v3-shape and then migrated to v4.
 * - v1 inputs are migrated up through v2 → v3-shape → v4.
 *
 * This replaces the old migrateToV3 as the canonical migration endpoint.
 * @deprecated Use migrateToV4 in new code. migrateToV3 is kept for the
 * existing Scenes editor until it is updated to RoomDocument.
 */
export function migrateToV3(scene: SerializedScene): RoomDocument {
  // Delegate to migrateToV4 — v4 IS the current RoomDocument shape.
  return migrateToV4(scene);
}

/**
 * Promote any deserialized scene to the current v4 `RoomDocument`.
 *
 * - v4 inputs pass through unchanged.
 * - v3 inputs are migrated via migrateRoomV3toV4 (op + ×4 positions).
 * - v2 inputs gain an empty `groups` map and go through v3→v4.
 * - v1 inputs go through v2 migration, then v3→v4.
 */
export function migrateToV4(scene: SerializedScene): RoomDocument {
  if (scene.schemaVersion === 4) {
    return {
      schemaVersion: 4,
      name: scene.name,
      title: scene.title,
      updatedAt: scene.updatedAt,
      commands: scene.commands,
      groups: scene.groups,
    };
  }
  if (scene.schemaVersion === 3) {
    return migrateRoomV3toV4(scene);
  }
  if (scene.schemaVersion === 2) {
    // Promote v2 commands to v3-shape (no placeCube rewrite needed —
    // migrateRoomV3toV4 handles that; but v2 SceneDocument uses the
    // current PlaceObjectCommand.op which is already 'placeObject').
    const v3: SerializedRoomV3 = {
      schemaVersion: 3,
      name: scene.name,
      title: scene.title,
      updatedAt: scene.updatedAt,
      // v2 docs already have the new op string from newPlaceObject; cast
      // is safe — the v3 type accepts 'placeCube' | 'extrude' shapes.
      commands: scene.commands as SerializedRoomV3['commands'],
      groups: {},
    };
    return migrateRoomV3toV4(v3);
  }
  // v1 path: migrate to v2 first (cell-grid → placeObject commands).
  const v2 = migrateToV2(scene);
  const v3: SerializedRoomV3 = {
    schemaVersion: 3,
    name: v2.name,
    title: v2.title,
    updatedAt: v2.updatedAt,
    commands: v2.commands as SerializedRoomV3['commands'],
    groups: {},
  };
  return migrateRoomV3toV4(v3);
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

