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
 */
export interface SceneDocument {
  schemaVersion: 2;
  name: string;
  title?: string;
  updatedAt?: number;
  commands: SceneCommand[];
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
