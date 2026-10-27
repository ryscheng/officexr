/**
 * TDD tests for checkMoveOccupancy — written BEFORE implementation.
 */
import { describe, it, expect } from 'vitest';
import { checkMoveOccupancy } from './moveOccupancy.ts';
import { emptyRoomDocument } from '@officexr/world/scenes';
import type { RoomDocument, PlaceObjectCommand } from '@officexr/world/scenes';
import { BEAM, CUBE, PEG, WALL, footprintOf } from './__tests__/yawedKinds.ts';

function cmd(
  id: string,
  kind: { id: string },
  position: [number, number, number],
): PlaceObjectCommand {
  return { id, op: 'placeObject', kindId: kind.id, position };
}

function makeCmd(id: string, position: [number, number, number]): PlaceObjectCommand {
  return cmd(id, PEG, position);
}

function makeDoc(commands: PlaceObjectCommand[]): RoomDocument {
  return { ...emptyRoomDocument('test'), commands };
}

const check = (
  doc: RoomDocument,
  movingIds: ReadonlySet<string>,
  proposed: ReadonlyMap<string, [number, number, number]>,
) => checkMoveOccupancy(doc, movingIds, proposed, footprintOf);

describe('checkMoveOccupancy', () => {
  // 1. no collision
  it('single object moved to empty voxel → ok', () => {
    const doc = makeDoc([makeCmd('a', [0, 0, 0])]);
    const movingIds = new Set(['a']);
    const proposedPositions = new Map([['a', [5, 0, 5] as [number, number, number]]]);
    expect(check(doc, movingIds, proposedPositions)).toBe('ok');
  });

  // 2. self-exclusion
  it('moving object to its own original voxel → ok (moving ids excluded from occupancy)', () => {
    const doc = makeDoc([makeCmd('a', [3, 0, 3])]);
    const movingIds = new Set(['a']);
    // Propose moving 'a' back to its own position (no actual move, but still valid)
    const proposedPositions = new Map([['a', [3, 0, 3] as [number, number, number]]]);
    expect(check(doc, movingIds, proposedPositions)).toBe('ok');
  });

  // 3. collision with static
  it('moving to a voxel occupied by a non-moving object → blocked', () => {
    const doc = makeDoc([makeCmd('a', [0, 0, 0]), makeCmd('static-b', [1, 0, 0])]);
    const movingIds = new Set(['a']);
    const proposedPositions = new Map([['a', [1, 0, 0] as [number, number, number]]]);
    expect(check(doc, movingIds, proposedPositions)).toBe('blocked');
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
    expect(check(doc, movingIds, proposedPositions)).toBe('ok');
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
    expect(check(doc, movingIds, proposedPositions)).toBe('blocked');
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
    expect(check(doc, movingIds, proposedPositions)).toBe('ok');
  });

  // 7. multi-voxel footprint catches overlap
  it('a 4×4×4 mover overlapping a static voxel in its footprint → blocked', () => {
    // Static voxel at [0,0,0]; the mover proposed at [-1,0,-1] covers [-1..2, 0..3, -1..2].
    const doc = makeDoc([cmd('static', PEG, [0, 0, 0]), cmd('mover', CUBE, [20, 0, 20])]);
    const proposedPositions = new Map<string, [number, number, number]>([['mover', [-1, 0, -1]]]);
    expect(check(doc, new Set(['mover']), proposedPositions)).toBe('blocked');
  });

  // 8. multi-voxel footprint ok when no overlap
  it('a 4×4×4 mover ok when the static voxel is far away', () => {
    const doc = makeDoc([cmd('static', PEG, [10, 0, 10]), cmd('mover', CUBE, [20, 0, 20])]);
    const proposedPositions = new Map<string, [number, number, number]>([['mover', [0, 0, 0]]]);
    expect(check(doc, new Set(['mover']), proposedPositions)).toBe('ok');
  });

  // 9. self-overlap is not a collision
  it('a 4×4×4 mover moved one voxel, overlapping its own old footprint → ok', () => {
    const doc = makeDoc([cmd('mover', CUBE, [0, 0, 0])]);
    const proposedPositions = new Map<string, [number, number, number]>([['mover', [1, 0, 0]]]);
    expect(check(doc, new Set(['mover']), proposedPositions)).toBe('ok');
  });
});

describe('checkMoveOccupancy with yawed footprints', () => {
  const place = (
    id: string,
    kindId: string,
    position: [number, number, number],
    yawDeg?: number,
  ): PlaceObjectCommand => ({
    id,
    op: 'placeObject',
    kindId,
    position,
    ...(yawDeg !== undefined && { yawDeg }),
  });
  const moveTo = (
    commands: PlaceObjectCommand[],
    to: [number, number, number],
  ) =>
    checkMoveOccupancy(
      makeDoc(commands),
      new Set(['mover']),
      new Map([['mover', to]]),
      footprintOf,
    );
  const FAR: [number, number, number] = [40, 0, 40];

  it('a 4×1 wall at yaw 0 blocks along x, not along z', () => {
    const doc = [place('static', WALL.id, [0, 0, 0]), place('mover', PEG.id, FAR)];
    expect(moveTo(doc, [3, 0, 0])).toBe('blocked');
    expect(moveTo(doc, [4, 0, 0])).toBe('ok');
    expect(moveTo(doc, [0, 0, 1])).toBe('ok');
  });

  it('a 4×1 wall at yaw 90 occupies 1×4: blocks along z, not along x', () => {
    // Footprint of the wall at the origin turned 90 degrees: x [2,3), z [-1,3).
    const doc = [place('static', WALL.id, [0, 0, 0], 90), place('mover', PEG.id, FAR)];
    expect(moveTo(doc, [2, 0, -1])).toBe('blocked');
    expect(moveTo(doc, [2, 0, 2])).toBe('blocked');
    expect(moveTo(doc, [2, 0, 3])).toBe('ok');
    expect(moveTo(doc, [1, 0, 0])).toBe('ok');
    expect(moveTo(doc, [3, 0, 0])).toBe('ok');
  });

  it('a moving wall is checked at its own yaw', () => {
    const peg = place('static', PEG.id, [2, 0, 2]);
    // Unrotated at [0,0,2] it spans x [0,4), z [2,3), which covers the peg.
    expect(moveTo([peg, place('mover', WALL.id, FAR, 0)], [0, 0, 2])).toBe('blocked');
    // Turned 90 degrees at [0,0,2] it spans x [2,3), z [1,5), which also covers it.
    expect(moveTo([peg, place('mover', WALL.id, FAR, 90)], [0, 0, 2])).toBe('blocked');
    // Turned 90 degrees at [-1,0,2] it spans x [1,2), z [1,5): clear of the peg.
    expect(moveTo([peg, place('mover', WALL.id, FAR, 90)], [-1, 0, 2])).toBe('ok');
    expect(moveTo([peg, place('mover', WALL.id, FAR, 0)], [-1, 0, 2])).toBe('blocked');
  });

  it('two walls at yaw 90 can sit one voxel apart', () => {
    const doc = [place('a', WALL.id, [0, 0, 0], 90), place('mover', WALL.id, FAR, 90)];
    expect(moveTo(doc, [1, 0, 0])).toBe('ok');
    expect(moveTo(doc, [0, 0, 2])).toBe('blocked');
  });

  it('a 4×2 beam at yaw 90 occupies exactly 2×4', () => {
    // Footprint of the beam at the origin turned 90 degrees: x [1,3), z [-1,3).
    const doc = [place('static', BEAM.id, [0, 0, 0], 90), place('mover', PEG.id, FAR)];
    expect(moveTo(doc, [1, 0, -1])).toBe('blocked');
    expect(moveTo(doc, [2, 0, 2])).toBe('blocked');
    expect(moveTo(doc, [0, 0, 0])).toBe('ok');
    expect(moveTo(doc, [3, 0, 0])).toBe('ok');
    expect(moveTo(doc, [1, 0, 3])).toBe('ok');
  });
});
