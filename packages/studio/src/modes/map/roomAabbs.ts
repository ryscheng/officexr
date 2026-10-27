import type { InstanceGeometryService, RoomService } from '@officexr/world/app';
import type { LayoutDocument, MapDocumentV2, RoomDocument } from '@officexr/world/scenes';
import type { RoomAABBVoxel } from './roomBoundarySnap.ts';

/**
 * One inclusive world-voxel AABB per placement, from the same `compileMap`
 * output the renderer shows (so rotation and baked layouts match what is drawn).
 * Placements with no compiled instances get none.
 */
export function computeRoomAabbs(
  map: MapDocumentV2,
  rooms: ReadonlyMap<string, RoomDocument>,
  layouts: ReadonlyMap<string, LayoutDocument>,
  roomService: Pick<RoomService, 'compileMap'>,
  geometry: Pick<InstanceGeometryService, 'voxelFootprint'>,
): RoomAABBVoxel[] {
  const { instances } = roomService.compileMap(map, rooms, layouts);
  return map.rooms.flatMap((ri) => {
    const prefix = `${ri.id}/`;
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const inst of instances) {
      if (!inst.id.startsWith(prefix)) {
        continue;
      }
      const fp = geometry.voxelFootprint(inst.position, inst.kindId);
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], fp.min[axis]);
        // VoxelFootprint.max is exclusive; RoomAABBVoxel.max is inclusive.
        max[axis] = Math.max(max[axis], fp.max[axis] - 1);
      }
    }
    return min[0] === Infinity ? [] : { id: ri.id, min, max };
  });
}
