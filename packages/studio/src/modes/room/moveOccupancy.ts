import type { SceneCommand } from '@officexr/world/scenes';

/**
 * Returns a string key uniquely identifying a voxel position.
 * Used to build occupancy sets for collision detection.
 */
export function voxelKey(p: [number, number, number]): string {
  return `${p[0]},${p[1]},${p[2]}`;
}

/** Per-axis voxel footprint of an object. */
export interface VoxelFootprint {
  w: number;
  h: number;
  d: number;
}

/**
 * Checks whether proposed new positions for a set of moving objects
 * would collide with any non-moving objects in the room.
 *
 * Both the moving objects' proposed positions and the existing
 * non-moving objects' positions are expanded into their multi-voxel
 * footprints — a 2 m cube on the 0.5 m grid occupies a 4×4×4 voxel
 * block. The check returns 'blocked' if ANY voxel of a moving
 * footprint overlaps ANY voxel of a non-moving footprint.
 *
 * @param doc - The current room document
 * @param movingIds - Command ids of objects being moved (excluded from
 *   the occupancy set so a moving object doesn't collide with itself)
 * @param proposedPositions - Map of commandId → proposed new position
 * @param movingFootprint - Optional per-axis footprint applied to each
 *   moving object. Defaults to {w:1, h:1, d:1}. For a multi-kind move
 *   set with mixed footprints, prefer `kindFootprint` below; this
 *   single-shape param exists for back-compat with the single-kind
 *   callers in `MoveController.tsx`.
 * @param kindFootprint - Optional lookup that returns the footprint of
 *   each existing placeObject command's kind. When omitted, existing
 *   instances are treated as 1-voxel (legacy behaviour). Studio passes
 *   `(kindId) => getKindStride(kindId, voxelSize)`-derived footprints.
 * @returns 'ok' if no collision, 'blocked' if any proposed position is occupied
 */
export function checkMoveOccupancy(
  doc: { commands: readonly SceneCommand[] },
  movingIds: ReadonlySet<string>,
  proposedPositions: ReadonlyMap<string, [number, number, number]>,
  movingFootprint?: VoxelFootprint,
  kindFootprint?: (kindId: string) => VoxelFootprint,
): 'ok' | 'blocked' {
  const mw = movingFootprint?.w ?? 1;
  const mh = movingFootprint?.h ?? 1;
  const md = movingFootprint?.d ?? 1;

  // Build occupancy set from all non-moving placeObject commands,
  // expanded over each object's per-kind voxel footprint.
  const occupancy = new Set<string>();
  for (const c of doc.commands) {
    if (c.op !== 'placeObject' || movingIds.has(c.id)) continue;
    const fp = kindFootprint ? kindFootprint(c.kindId) : { w: 1, h: 1, d: 1 };
    const [ox, oy, oz] = c.position;
    for (let dx = 0; dx < fp.w; dx++) {
      for (let dy = 0; dy < fp.h; dy++) {
        for (let dz = 0; dz < fp.d; dz++) {
          occupancy.add(voxelKey([ox + dx, oy + dy, oz + dz]));
        }
      }
    }
  }

  // Check each proposed position's full footprint against the occupancy set.
  for (const pos of proposedPositions.values()) {
    for (let dx = 0; dx < mw; dx++) {
      for (let dy = 0; dy < mh; dy++) {
        for (let dz = 0; dz < md; dz++) {
          if (occupancy.has(voxelKey([pos[0] + dx, pos[1] + dy, pos[2] + dz]))) {
            return 'blocked';
          }
        }
      }
    }
  }

  return 'ok';
}
