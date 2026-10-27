import type { FootprintOf } from './footprint.ts';

/**
 * Settles a gravity-enabled object proposed at `proposedVoxel` onto the
 * highest placed object under any cell of its (yawed) footprint. Only
 * supports whose top is at or below the proposed footprint's bottom count.
 * The world floor is not a support: with none, returns `null` and the
 * placement is rejected.
 */
export function dropToSurface(
  proposedVoxel: [number, number, number],
  dropped: { kindId: string; yawDeg?: number },
  worldObjects: {
    instances: ReadonlyArray<{
      position: readonly [number, number, number];
      kindId: string;
      yawDeg?: number;
    }>;
  },
  footprintOf: FootprintOf,
): [number, number, number] | null {
  const box = footprintOf(proposedVoxel, dropped.kindId, dropped.yawDeg);
  let supportTop = -Infinity;

  for (const inst of worldObjects.instances) {
    const fp = footprintOf(inst.position, inst.kindId, inst.yawDeg);
    if (fp.max[1] > box.min[1]) continue;
    if (fp.max[0] <= box.min[0] || fp.min[0] >= box.max[0]) continue;
    if (fp.max[2] <= box.min[2] || fp.min[2] >= box.max[2]) continue;
    supportTop = Math.max(supportTop, fp.max[1]);
  }

  if (supportTop === -Infinity) {
    return null;
  }
  const [px, py, pz] = proposedVoxel;
  return [px, py + supportTop - box.min[1], pz];
}
