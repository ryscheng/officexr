import type { WorldMap } from '@officexr/sdk';

/**
 * One static-collider descriptor in world space. The actual Rapier
 * shape construction lives in the adapter (browser or Node) since
 * each uses a different binding; this helper is the engine-agnostic
 * description.
 */
export interface WallDescriptor {
  /** Centre of the cuboid in world XZ. Y is mid-height. */
  center: { x: number; y: number; z: number };
  /** Half-extents along world XYZ. */
  halfExtents: { x: number; y: number; z: number };
}

/**
 * Build the four floor-edge walls for a `WorldMap`. The walls stand
 * tall (Y +5 m) and just outside the playable area so a character
 * collides with them at the same boundary the old `resolveMovement`
 * clamp enforced (`±halfExtent - charRadius`).
 *
 * Future: also walk `map.layers` and emit a cuboid per non-walkable
 * cell. For now `layers` is empty in the debug-app, so only the
 * perimeter walls are produced.
 */
export function worldMapToWalls(map: WorldMap): WallDescriptor[] {
  const halfExtent = (map.gridSize * map.cubeSize) / 2;
  const thickness = 0.5;
  const height = 5;
  const halfH = height / 2;
  const halfT = thickness / 2;
  const span = halfExtent + thickness; // wall extends past the corner
  return [
    // +X wall (east)
    {
      center: { x: halfExtent + halfT, y: halfH, z: 0 },
      halfExtents: { x: halfT, y: halfH, z: span },
    },
    // -X wall (west)
    {
      center: { x: -(halfExtent + halfT), y: halfH, z: 0 },
      halfExtents: { x: halfT, y: halfH, z: span },
    },
    // +Z wall (south)
    {
      center: { x: 0, y: halfH, z: halfExtent + halfT },
      halfExtents: { x: span, y: halfH, z: halfT },
    },
    // -Z wall (north)
    {
      center: { x: 0, y: halfH, z: -(halfExtent + halfT) },
      halfExtents: { x: span, y: halfH, z: halfT },
    },
  ];
}
