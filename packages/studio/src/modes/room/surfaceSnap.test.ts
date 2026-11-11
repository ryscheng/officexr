/**
 * Sub-grid surface placement in the Room / Layout editors: objects rest on
 * another object's exact surface (not only on the 0.5 m grid) and the
 * occupancy, drop and move guards agree.
 */
import { describe, expect, it } from 'vitest';
import { emptyRoomDocument, type PlaceObjectCommand } from '@officexr/world/scenes';
import { dropToSurface } from './dropToSurface.ts';
import { newObjectShape, overlapsAnyInstance } from './footprint.ts';
import { checkMoveOccupancy } from './moveOccupancy.ts';
import {
  CENTRE_SNAP_M,
  snapToGridOrStack,
  snapToNearestFace,
  snapToVoxel,
  type NearbyObjectInfo,
} from './roomSnap.ts';
import { CUBE, DESK, PEG, RUG, TILE, footprintOf, geometry } from './__tests__/yawedKinds.ts';

type Vec3 = [number, number, number];
const VS = 0.5;

/** What the editor feeds the snap: each placed object's footprint, in metres. */
const nearby = (position: Vec3, kindId: string, yawDeg?: number): NearbyObjectInfo => {
  const { min, max } = footprintOf(position, kindId, yawDeg);
  const m = (v: readonly number[]) => [v[0] * VS, v[1] * VS, v[2] * VS] as const;
  return { position, aabb: { min: m(min), max: m(max) } };
};
const at = (position: Vec3, kindId: string) => ({ position, kindId });

describe('createFootprintOf sub-grid regime', () => {
  it('a thin tile at a whole voxel occupies its exact 0.15 m, not a whole voxel', () => {
    expect(footprintOf([0, 0, 0], TILE.id)).toEqual({ min: [0, 0, 0], max: [7, 0.3, 7] });
  });

  it('a whole-voxel kind at a sub-grid position occupies its exact box', () => {
    expect(footprintOf([0, 0.3, 0.5], CUBE.id)).toEqual({ min: [0, 0.3, 0.5], max: [4, 4.3, 4.5] });
  });

  it('whole-voxel placements of whole-voxel kinds keep the grid footprint', () => {
    expect(footprintOf([2, 0, 2], CUBE.id)).toEqual({ min: [2, 0, 2], max: [6, 4, 6] });
  });
});

describe('placing on a thin floor tile', () => {
  const tile = nearby([0, 0, 0], TILE.id);

  it('the face snap rests a rug on the tile top (y = 0.15 m = 0.3 voxel)', () => {
    const voxel = snapToNearestFace({ x: 0.3, y: 0.15, z: 0.3 }, newObjectShape(geometry, RUG.id), [tile], VS, 2.5, {
      cameraY: 10,
    })!;
    expect(voxel[1]).toBe(0.3);
    expect(overlapsAnyInstance(footprintOf(voxel, RUG.id), [at([0, 0, 0], TILE.id)], footprintOf)).toBe(false);
  });

  it('the grid fallback stacks on the tile top, not a whole voxel up', () => {
    const voxel = snapToGridOrStack(
      { kind: 'floor', point: { x: 0.6, y: 0, z: 0.6 } },
      newObjectShape(geometry, PEG.id),
      [tile],
      VS,
      undefined,
      10,
    );
    expect(voxel).toEqual([1, 0.3, 1]);
  });

  it('a block sitting on the tile is not an overlap; one sunk into it is', () => {
    const placed = [at([0, 0, 0], TILE.id)];
    expect(overlapsAnyInstance(footprintOf([0, 0.3, 0], CUBE.id), placed, footprintOf)).toBe(false);
    expect(overlapsAnyInstance(footprintOf([0, 0, 0], CUBE.id), placed, footprintOf)).toBe(true);
  });

  it('a gravity drop settles on the tile top', () => {
    expect(dropToSurface([1, 5, 1], { kindId: PEG.id }, { instances: [at([0, 0, 0], TILE.id)] }, footprintOf)).toEqual([
      1, 0.3, 1,
    ]);
  });

  it('moving a block from the tile to beside it keeps the sub-grid Y and is not blocked by the tile', () => {
    const doc = {
      ...emptyRoomDocument('r'),
      commands: [
        { id: 'tile', op: 'placeObject', kindId: TILE.id, position: [0, 0, 0] },
        { id: 'peg', op: 'placeObject', kindId: PEG.id, position: [1, 0.3, 1] },
      ] satisfies PlaceObjectCommand[],
    };
    const move = (to: Vec3) => checkMoveOccupancy(doc, new Set(['peg']), new Map([['peg', to]]), footprintOf);
    expect(move([2, 0.3, 2])).toBe('ok');
    expect(move([2, 0.2, 2])).toBe('blocked');
  });
});

describe('placing on a desk top and centring', () => {
  // A desk on the tile: its base at 0.15 m, its top at 1.15 m.
  const desk = nearby([0, 0.3, 0], DESK.id);

  it('a prop on the desk lands on its exact top (2.3 voxels)', () => {
    const voxel = snapToNearestFace({ x: 0.3, y: 1.15, z: 0.1 }, newObjectShape(geometry, PEG.id), [desk], VS, 2.5, {
      cameraY: 10,
    })!;
    expect(voxel).toEqual([0, 2.3, 0]);
  });

  it(`within ${CENTRE_SNAP_M} m of the top's centre the prop centres on it`, () => {
    const voxel = snapToNearestFace({ x: 1.6, y: 1.15, z: 0.4 }, newObjectShape(geometry, PEG.id), [desk], VS, 2.5, {
      cameraY: 10,
    })!;
    // Desk top centre (1.5, 0.5) m; a 0.5 m peg centred there has its corner at (1.25, 0.25) m.
    expect(voxel).toEqual([2.5, 2.3, 0.5]);
  });

  it('a 3 m desk centres on a 3.5 m slab (0.25 m in from each end)', () => {
    const slab = nearby([0, 0, 0], TILE.id);
    const voxel = snapToNearestFace({ x: 1.8, y: 0.15, z: 1.7 }, newObjectShape(geometry, DESK.id), [slab], VS, 2.5, {
      cameraY: 10,
    })!;
    // Slab top centre (1.75, 1.75) m; the 3 × 1 m desk's corner at (0.25, 1.25) m.
    expect(voxel).toEqual([0.5, 0.3, 2.5]);
  });

  it('beside a raised desk, a side-face snap stands on the desk base level, not below it', () => {
    // The cursor's height (0.2 m) rounds to the 0 grid row, below the desk's 0.15 m base.
    const voxel = snapToNearestFace({ x: 1.6, y: 0.2, z: -0.1 }, newObjectShape(geometry, PEG.id), [desk], VS, 2.5)!;
    expect(voxel).toEqual([3, 0.3, -1]);
  });
});

describe('snapToVoxel floor hits', () => {
  it('keeps rounding the build-height plane to whole voxels', () => {
    expect(snapToVoxel({ kind: 'floor', point: { x: 0, y: 0.15, z: 0 } }, VS)).toEqual([0, 0, 0]);
  });

  it('honours an exact up-facing surface hit (a baked floor tile) at its sub-grid height', () => {
    expect(snapToVoxel({ kind: 'floor', point: { x: 0, y: 0.15, z: 0 }, exactY: true }, VS)).toEqual([0, 0.3, 0]);
  });
});
