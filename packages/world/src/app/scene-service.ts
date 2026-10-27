/**
 * Default `SceneService` — a static lookup of programmatic scenes used
 * by visual regression tests (and any other tooling that needs a
 * deterministic snapshot of placed objects). Lives in the application
 * layer so the headless harness and the UI consume the same shape.
 *
 * Adding a scene: define an entry in `SCENES`. Keep them small and
 * deterministic — no randomness, no time-of-day variation, no
 * dependence on locally-edited rooms.
 */

import type {
  CameraPose,
  ProgrammaticScene,
  SceneService,
  Vec3,
} from './types.ts';
import type { ObjectInstance } from '@officexr/sdk';

function inst(
  id: string,
  kindId: string,
  position: Vec3,
): ObjectInstance {
  return {
    id,
    sourceCommandId: id,
    kindId,
    position: [position[0], position[1], position[2]],
  };
}

function camera(
  target: Vec3,
  opts: { azimuthDeg: number; elevationDeg: number; distance: number },
): CameraPose {
  return {
    target,
    azimuth: (opts.azimuthDeg * Math.PI) / 180,
    elevation: (opts.elevationDeg * Math.PI) / 180,
    distance: opts.distance,
  };
}

/** Both reference cubes side-by-side. World layout under the anchor-
 * lower-left convention with voxelSize 0.5:
 *   - Blue cube at voxel (0,0,0)  → AABB (0,0,0)→(2,2,2)
 *   - Large A   at voxel (8,0,0)  → AABB (4,0,0)→(8,4,4)  (1 m gap on X)
 * Camera centered on the midpoint so both cubes are in frame. */
const blueAndLargeA: ProgrammaticScene = {
  id: 'blue-and-large-a',
  instances: [
    inst('p1', 'colored_block_blue', [0, 0, 0]),
    inst('p2', 'prototype_cube_prototype_large_a', [8, 0, 0]),
  ],
  camera: camera([4, 2, 2], {
    azimuthDeg: 35,
    elevationDeg: 25,
    distance: 12,
  }),
  selection: new Set(['p1', 'p2']),
};

/** Just the Blue cube — pins the 2 m wireframe alignment in isolation. */
const blueWireframe: ProgrammaticScene = {
  id: 'blue-wireframe',
  instances: [inst('blue', 'colored_block_blue', [0, 0, 0])],
  camera: camera([1, 1, 1], { azimuthDeg: 35, elevationDeg: 25, distance: 5 }),
  selection: new Set(['blue']),
};

/** Just the Cube Prototype Large A — pins the 4 m wireframe in isolation. */
const largeAWireframe: ProgrammaticScene = {
  id: 'large-a-wireframe',
  instances: [
    inst('largeA', 'prototype_cube_prototype_large_a', [0, 0, 0]),
  ],
  camera: camera([2, 2, 2], { azimuthDeg: 35, elevationDeg: 25, distance: 10 }),
  selection: new Set(['largeA']),
};

const SCENES: Record<string, ProgrammaticScene> = {
  [blueAndLargeA.id]: blueAndLargeA,
  [blueWireframe.id]: blueWireframe,
  [largeAWireframe.id]: largeAWireframe,
};

export function createSceneService(): SceneService {
  return {
    list: () => Object.keys(SCENES),
    load: (id) => {
      const scene = SCENES[id];
      if (!scene) {
        throw new Error(`SceneService: unknown scene "${id}"`);
      }
      return scene;
    },
  };
}
