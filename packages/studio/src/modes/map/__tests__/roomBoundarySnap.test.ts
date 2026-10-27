import { describe, expect, it } from 'vitest';
import {
  snapRoomToNeighbors,
  type RoomAABBVoxel,
} from '../roomBoundarySnap.ts';

// All AABBs are voxel-space, inclusive. Y is unused by the snap helper
// but included for completeness so the shape matches the runtime
// usage in MapEditorCanvas.

function room(
  id: string,
  min: [number, number, number],
  max: [number, number, number],
): RoomAABBVoxel {
  return { id, min, max };
}

describe('snapRoomToNeighbors', () => {
  it('snaps moving.min flush to the right of a neighbor on +X', () => {
    // Moving room at x=[5..8]; neighbor occupies x=[0..3].
    // Flush placement is moving.min == 4, i.e. dx = 4 - 5 = -1.
    const moving = room('m', [5, 0, 0], [8, 4, 4]);
    const neighbor = room('n', [0, 0, 0], [3, 4, 4]);
    expect(snapRoomToNeighbors(moving, [neighbor], 2)).toEqual({
      dx: -1,
      dz: 0,
    });
  });

  it('snaps moving.max flush to the left of a neighbor on -X', () => {
    // Neighbor at x=[10..13]; moving at x=[6..8] wants its max=9 (one
    // less than 10): dx = 9 - 8 = 1.
    const moving = room('m', [6, 0, 0], [8, 4, 4]);
    const neighbor = room('n', [10, 0, 0], [13, 4, 4]);
    expect(snapRoomToNeighbors(moving, [neighbor], 2)).toEqual({
      dx: 1,
      dz: 0,
    });
  });

  it('snaps along a shared wall (co-planar min)', () => {
    // Moving and neighbor are not adjacent on X, but their Z mins are
    // 1 apart. The co-planar candidate (moving.min == neighbor.min)
    // gives dz = -1 — well within the 2-voxel threshold.
    const moving = room('m', [10, 0, 1], [13, 4, 4]);
    const neighbor = room('n', [0, 0, 0], [3, 4, 3]);
    expect(snapRoomToNeighbors(moving, [neighbor], 2).dz).toBe(-1);
  });

  it('does not snap when the gap is outside the threshold', () => {
    const moving = room('m', [10, 0, 0], [13, 4, 4]);
    const neighbor = room('n', [0, 0, 0], [3, 4, 4]);
    // Gap on X is 10 - 4 = 6 voxels; co-planar candidates are 10 and 6
    // — all > threshold (2).
    expect(snapRoomToNeighbors(moving, [neighbor], 2)).toEqual({
      dx: 0,
      dz: 0,
    });
  });

  it('snaps X and Z independently', () => {
    // Moving room needs dx = -1 (flush right of n1 on X) AND
    // dz = +1 (co-planar with n2 on Z).
    const moving = room('m', [5, 0, -1], [8, 4, 2]);
    const n1 = room('n1', [0, 0, 0], [3, 4, 3]);
    const n2 = room('n2', [20, 0, 0], [23, 4, 5]);
    const result = snapRoomToNeighbors(moving, [n1, n2], 2);
    expect(result.dx).toBe(-1);
    expect(result.dz).toBe(1);
  });

  it('already-aligned faces return 0 on that axis', () => {
    // Moving.min == neighbor.max + 1 on X — already flush, no snap.
    const moving = room('m', [4, 0, 0], [7, 4, 4]);
    const neighbor = room('n', [0, 0, 0], [3, 4, 4]);
    expect(snapRoomToNeighbors(moving, [neighbor], 2).dx).toBe(0);
  });

  it('picks the smallest absolute delta when multiple neighbors compete', () => {
    // Two competing snaps on X: neighbor A wants delta=+2, neighbor B
    // wants delta=-1. B wins (smaller |delta|).
    const moving = room('m', [5, 0, 0], [8, 4, 4]);
    const a = room('a', [10, 0, 0], [13, 4, 4]); // wants moving.max==9 → dx=+1
    const b = room('b', [0, 0, 0], [3, 4, 4]); // wants moving.min==4 → dx=-1
    const result = snapRoomToNeighbors(moving, [a, b], 2);
    expect(Math.abs(result.dx)).toBe(1);
  });

  it('breaks ties by neighbor id (stable)', () => {
    // Two neighbors produce candidates with the same |delta|. The one
    // with the lexicographically-smaller id wins.
    const moving = room('m', [5, 0, 0], [8, 4, 4]);
    const a = room('a', [9, 0, 0], [12, 4, 4]); // moving.max==8 already flush ish → mix
    // Actually engineer two candidates with same |delta| = 1 but
    // different sign coming from different neighbors:
    const left = room('left', [0, 0, 0], [3, 4, 4]); // dx = -1
    const right = room('right', [10, 0, 0], [13, 4, 4]); // dx = +1
    const r1 = snapRoomToNeighbors(moving, [left, right], 2);
    const r2 = snapRoomToNeighbors(moving, [right, left], 2);
    expect(r1).toEqual(r2); // order-independent
    expect(r1.dx).toBe(-1); // 'left' < 'right' lexicographically
  });

  it('ignores neighbors whose id equals the moving room id', () => {
    const moving = room('m', [5, 0, 0], [8, 4, 4]);
    const self = room('m', [0, 0, 0], [3, 4, 4]);
    expect(snapRoomToNeighbors(moving, [self], 2)).toEqual({ dx: 0, dz: 0 });
  });
});
