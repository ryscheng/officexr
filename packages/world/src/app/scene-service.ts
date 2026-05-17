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

const blueAndLargeA: ProgrammaticScene = {
  id: 'blue-and-large-a',
  instances: [
    // Blue cube at voxel (0,0,0) → world AABB (-1, 0, -1) → (1, 2, 1)
    inst('p1', 'colored_block_blue', [0, 0, 0]),
    // Cube Prototype Large A at voxel (8,0,0) → world AABB (2, 0, -2) → (6, 4, 2).
    // Voxel 8 with vs=0.5 = world x=4, dims 4 → spans 2..6. 1m gap from Blue.
    inst('p2', 'prototype_cube_prototype_large_a', [8, 0, 0]),
  ],
  // Look at the midpoint of the two cubes. Both selected so the
  // wireframe renders for the visual regression.
  camera: camera([2, 1.5, 0], {
    azimuthDeg: 35,
    elevationDeg: 25,
    distance: 10,
  }),
  selection: new Set(['p1', 'p2']),
};

const SCENES: Record<string, ProgrammaticScene> = {
  [blueAndLargeA.id]: blueAndLargeA,
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
