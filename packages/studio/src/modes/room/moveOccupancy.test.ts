/**
 * TDD tests for checkMoveOccupancy — written BEFORE implementation.
 */
import { describe, it, expect } from 'vitest';
import { checkMoveOccupancy } from './moveOccupancy.ts';
import { emptyRoomDocument } from '@officexr/world/scenes';
import type { RoomDocument, PlaceObjectCommand } from '@officexr/world/scenes';

function makeCmd(id: string, position: [number, number, number]): PlaceObjectCommand {
  return { id, op: 'placeObject', kindId: 'block-grass', position };
}

function makeDoc(commands: PlaceObjectCommand[]): RoomDocument {
  return { ...emptyRoomDocument('test'), commands };
}

describe('checkMoveOccupancy', () => {
  // 1. no collision
  it('single object moved to empty voxel → ok', () => {
    const doc = makeDoc([makeCmd('a', [0, 0, 0])]);
    const movingIds = new Set(['a']);
    const proposedPositions = new Map([['a', [5, 0, 5] as [number, number, number]]]);
    expect(checkMoveOccupancy(doc, movingIds, proposedPositions)).toBe('ok');
  });

  // 2. self-exclusion
  it('moving object to its own original voxel → ok (moving ids excluded from occupancy)', () => {
    const doc = makeDoc([makeCmd('a', [3, 0, 3])]);
    const movingIds = new Set(['a']);
    // Propose moving 'a' back to its own position (no actual move, but still valid)
    const proposedPositions = new Map([['a', [3, 0, 3] as [number, number, number]]]);
    expect(checkMoveOccupancy(doc, movingIds, proposedPositions)).toBe('ok');
  });

  // 3. collision with static
  it('moving to a voxel occupied by a non-moving object → blocked', () => {
    const doc = makeDoc([makeCmd('a', [0, 0, 0]), makeCmd('static-b', [1, 0, 0])]);
    const movingIds = new Set(['a']);
    const proposedPositions = new Map([['a', [1, 0, 0] as [number, number, number]]]);
    expect(checkMoveOccupancy(doc, movingIds, proposedPositions)).toBe('blocked');
  });

  // 4. multi-select no collision
  it('all 3 selected objects moved to empty voxels → ok', () => {
    const doc = makeDoc([
      makeCmd('a', [0, 0, 0]),
      makeCmd('b', [1, 0, 0]),
      makeCmd('c', [2, 0, 0]),
    ]);
    const movingIds = new Set(['a', 'b', 'c']);
    const proposedPositions = new Map<string, [number, number, number]>([
      ['a', [10, 0, 0]],
      ['b', [11, 0, 0]],
      ['c', [12, 0, 0]],
    ]);
    expect(checkMoveOccupancy(doc, movingIds, proposedPositions)).toBe('ok');
  });

  // 5. multi-select partial collision
  it('2 of 3 ok, 1 lands on static → blocked', () => {
    const doc = makeDoc([
      makeCmd('a', [0, 0, 0]),
      makeCmd('b', [1, 0, 0]),
      makeCmd('c', [2, 0, 0]),
      makeCmd('static-x', [20, 0, 0]),
    ]);
    const movingIds = new Set(['a', 'b', 'c']);
    const proposedPositions = new Map<string, [number, number, number]>([
      ['a', [10, 0, 0]],
      ['b', [11, 0, 0]],
      ['c', [20, 0, 0]], // lands on static-x
    ]);
    expect(checkMoveOccupancy(doc, movingIds, proposedPositions)).toBe('blocked');
  });

  // 6. multi-select swap — two selected objects swapping positions → ok
  it('two selected objects swapping positions → ok (both excluded from occupancy)', () => {
    const doc = makeDoc([makeCmd('a', [0, 0, 0]), makeCmd('b', [1, 0, 0])]);
    const movingIds = new Set(['a', 'b']);
    const proposedPositions = new Map<string, [number, number, number]>([
      ['a', [1, 0, 0]], // moves to b's original spot
      ['b', [0, 0, 0]], // moves to a's original spot
    ]);
    // Both are moving, neither collides with any STATIC object
    expect(checkMoveOccupancy(doc, movingIds, proposedPositions)).toBe('ok');
  });

  // 7. multi-voxel footprint catches overlap
  it('multi-voxel footprint {w:4,h:4,d:4} catches overlap with static at [0,0,0]', () => {
    // Static object at [0,0,0]. Propose a 4×4×4 footprint at [-1,0,-1].
    // The footprint covers [-1..2, 0..3, -1..2] which includes [0,0,0].
    const doc = makeDoc([makeCmd('static', [0, 0, 0])]);
    const movingIds = new Set<string>(['mover']);
    const proposedPositions = new Map<string, [number, number, number]>([
      ['mover', [-1, 0, -1]],
    ]);
    expect(checkMoveOccupancy(doc, movingIds, proposedPositions, { w: 4, h: 4, d: 4 })).toBe('blocked');
  });

  // 8. multi-voxel footprint ok when no overlap
  it('multi-voxel footprint {w:4,h:4,d:4} ok when static is far away', () => {
    const doc = makeDoc([makeCmd('static', [10, 0, 10])]);
    const movingIds = new Set<string>(['mover']);
    const proposedPositions = new Map<string, [number, number, number]>([
      ['mover', [0, 0, 0]],
    ]);
    expect(checkMoveOccupancy(doc, movingIds, proposedPositions, { w: 4, h: 4, d: 4 })).toBe('ok');
  });

  // 9. default footprint still 1-voxel (no footprint arg)
  it('default footprint is still 1-voxel (backward compat)', () => {
    const doc = makeDoc([makeCmd('a', [0, 0, 0]), makeCmd('static-b', [1, 0, 0])]);
    const movingIds = new Set(['a']);
    const proposedPositions = new Map([['a', [1, 0, 0] as [number, number, number]]]);
    expect(checkMoveOccupancy(doc, movingIds, proposedPositions)).toBe('blocked');
  });
});
