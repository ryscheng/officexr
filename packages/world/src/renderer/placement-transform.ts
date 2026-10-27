import type { RoomInstance } from '../scenes/map-document.ts';
import { VOXEL_SIZE } from './config.ts';

/**
 * A map placement (voxels, quarter turns) as a three.js group's position
 * and Euler rotation about the room origin, in the same sense as
 * `compileMap`'s rigid rotation. No placement is the identity.
 */
export function placementTransform(placement?: Pick<RoomInstance, 'position' | 'rotationY'>): {
  position: [number, number, number];
  rotation: [number, number, number];
} {
  const [x, y, z] = placement?.position ?? [0, 0, 0];
  return {
    position: [x * VOXEL_SIZE, y * VOXEL_SIZE, z * VOXEL_SIZE],
    rotation: [0, ((placement?.rotationY ?? 0) * Math.PI) / 2, 0],
  };
}
