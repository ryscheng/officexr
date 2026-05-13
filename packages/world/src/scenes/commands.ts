/**
 * CAD-style scene authoring commands. A `SceneDocument` is an ordered
 * list of these commands; replaying them in `compileScene` yields a
 * flat list of `ObjectInstance`s the renderer can draw.
 *
 * Adding a new command kind:
 *   1. Extend the `SceneCommand` union here.
 *   2. Add a switch case in `compileScene`.
 *   3. Add an Inspector renderer in studio so the user can edit it.
 * Forgetting (1) is a compile error in (2) thanks to the exhaustive
 * `never` check in `compileScene`.
 */

/** Cardinal axis-aligned face of a cube object. */
export type CubeFace = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';
export const CUBE_FACES: readonly CubeFace[] = [
  'px',
  'nx',
  'py',
  'ny',
  'pz',
  'nz',
];

/** Place a single cube at integer voxel coords. The first command in
 * a scene is almost always a placeCube. */
export interface PlaceCubeCommand {
  id: string;
  op: 'placeCube';
  kindId: string;
  position: [number, number, number];
}

/**
 * Tile cubes outward from a chosen face of an existing object.
 * `count` is the TOTAL number of cubes along the extrude direction
 * INCLUDING the source. So an extrude with count=3 from a single cube
 * gives a 1×3 row (the source plus 2 new cubes); count=1 is a no-op
 * (the source already exists); count <= 0 is a no-op too.
 *
 * `face` selects which direction to grow in. The new cubes inherit
 * the target's kind.
 */
export interface ExtrudeCommand {
  id: string;
  op: 'extrude';
  targetCommandId: string;
  face: CubeFace;
  count: number;
}

export type SceneCommand = PlaceCubeCommand | ExtrudeCommand;

/**
 * Versioned authoring document. `schemaVersion: 2` is the new
 * command-list format; v1 files (legacy `WorldMap` cell grids)
 * round-trip through `migrateV1ToV2` in `serialize.ts`.
 *
 * @deprecated Prefer `RoomDocument` (v3) for new code. `SceneDocument`
 * is kept as a type alias for v2 docs so the existing Scenes editor
 * keeps compiling during the studio multi-editor restructure; it will
 * be removed once every caller has migrated.
 */
export interface SceneDocument {
  schemaVersion: 2;
  name: string;
  title?: string;
  updatedAt?: number;
  commands: SceneCommand[];
}

/**
 * Grouping of commands in a `RoomDocument`. Groups are a
 * selection/lifecycle concern: a group's children are deleted together
 * by the Delete tool and selected together by the Select tool. They
 * are NOT a compile concern — `compileScene` does not look at groups.
 *
 * v1 invariant: each `commandId` belongs to at most one group.
 * Nesting is not supported in v1.
 *
 * Invariant: `id` must equal the `Record<string, RoomGroup>` key that
 * stores this group. Carrying the id inline is intentional so a group
 * passed around by reference (e.g. into the inspector) still knows its
 * own identity; the duplication is checked when the Room editor's
 * mutators write to the document.
 */
export interface RoomGroup {
  id: string;
  commandIds: string[];
  label?: string;
}

/**
 * Versioned authoring document for one Room.
 *
 * - **v3** (this) is the command-list room produced by the new Room
 *   editor. It drops the `spawnPoints` and `characterConfigs` slots
 *   that lived on v2 — those now belong on the parent `MapDocumentV1`.
 * - **v2** is the historical command-list "scene" — see `SceneDocument`.
 * - **v1** is the legacy cell-grid WorldMap.
 *
 * The on-disk wire form is `SerializedRoomV3` in `serialize.ts`.
 */
export interface RoomDocument {
  schemaVersion: 3;
  name: string;
  title?: string;
  updatedAt?: number;
  commands: SceneCommand[];
  groups: Record<string, RoomGroup>;
}

let nextCmdId = 1;
function mintCommandId(prefix: string): string {
  // Stable enough for in-session uniqueness; the studio assigns a
  // fresh sequence when a doc is loaded so saved files don't collide.
  return `${prefix}-${(nextCmdId++).toString(36)}-${Date.now().toString(36).slice(-4)}`;
}

export function newPlaceCube(opts: {
  kindId: string;
  position?: [number, number, number];
  id?: string;
}): PlaceCubeCommand {
  return {
    id: opts.id ?? mintCommandId('place'),
    op: 'placeCube',
    kindId: opts.kindId,
    position: opts.position ?? [0, 0, 0],
  };
}

export function newExtrude(opts: {
  targetCommandId: string;
  face: CubeFace;
  count: number;
  id?: string;
}): ExtrudeCommand {
  return {
    id: opts.id ?? mintCommandId('ext'),
    op: 'extrude',
    targetCommandId: opts.targetCommandId,
    face: opts.face,
    count: Math.max(0, Math.floor(opts.count)),
  };
}

export function emptyDocument(name: string, title?: string): SceneDocument {
  return {
    schemaVersion: 2,
    name,
    title,
    updatedAt: Date.now(),
    commands: [],
  };
}

export function emptyRoomDocument(name: string, title?: string): RoomDocument {
  return {
    schemaVersion: 3,
    name,
    title,
    updatedAt: Date.now(),
    commands: [],
    groups: {},
  };
}
