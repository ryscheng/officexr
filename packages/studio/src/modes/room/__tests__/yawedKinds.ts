import { createInstanceGeometry } from '@officexr/world/app';
import type { WorldObjectKind } from '@officexr/world/scenes';
import { createFootprintOf } from '../footprint.ts';

const VOXEL_SIZE = 0.5;

function kind(id: string, width: number, height: number, depth: number): WorldObjectKind {
  return {
    id,
    label: id,
    gltfPath: '/test.glb',
    swatch: '#000',
    walkable: false,
    scale: 1,
    tint: null,
    opacity: 1,
    roughness: null,
    metalness: null,
    emissive: null,
    emissiveIntensity: 0,
    category: 'block',
    tilingAxes: { x: true, y: true, z: true },
    gravity: false,
    isLayoutObject: false,
    optimization: 'none',
    dimensions: { width, height, depth },
  };
}

// 4×3×1 voxels: width and depth differ by an odd count, so a quarter turn
// puts the pivot on a half voxel.
export const WALL = kind('wall', 2, 1.5, 0.5);
// 4×3×2 voxels: even difference, quarter turns stay on the grid.
export const BEAM = kind('beam', 2, 1.5, 1);

// One voxel, as a probe.
export const PEG = kind('peg', 0.5, 0.5, 0.5);

// 4×4×4 voxels.
export const CUBE = kind('cube', 2, 2, 2);

// 2×1×1 voxels whose baked width carries float noise, as real catalog bakes do.
export const NOISY = kind('noisy', 1.0000001, 0.5, 0.5);

const kinds = [WALL, BEAM, PEG, CUBE, NOISY];

export const geometry = createInstanceGeometry({
  catalog: { getKind: (id) => kinds.find((k) => k.id === id) },
  voxelSize: VOXEL_SIZE,
});

export const footprintOf = createFootprintOf(geometry);
