import type { FootprintRect } from '@officexr/sdk';
import type { InstanceGeometryService, RoomService } from './types.ts';

export type Instances = ReturnType<RoomService['compileMap']>['instances'];

/** XZ union of the world AABBs of a placement's compiled instances, or null when it has none. */
export function roomXZBounds(
  instances: Instances,
  roomInstanceId: string,
  geometry: Pick<InstanceGeometryService, 'worldAABBOfInstance'>,
): FootprintRect | null {
  const prefix = `${roomInstanceId}/`;
  let min = { x: Infinity, z: Infinity };
  let max = { x: -Infinity, z: -Infinity };
  for (const inst of instances) {
    if (!inst.id.startsWith(prefix)) {
      continue;
    }
    const box = geometry.worldAABBOfInstance(inst);
    min = { x: Math.min(min.x, box.min[0]), z: Math.min(min.z, box.min[2]) };
    max = { x: Math.max(max.x, box.max[0]), z: Math.max(max.z, box.max[2]) };
  }
  return min.x === Infinity ? null : { min, max };
}
