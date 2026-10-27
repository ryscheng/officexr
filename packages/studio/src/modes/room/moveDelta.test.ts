/**
 * TDD tests for computeMovedPositions — written BEFORE implementation.
 */
import { describe, it, expect } from 'vitest';
import { computeMovedPositions } from './moveDelta.ts';
import { emptyRoomDocument } from '@officexr/world/scenes';
import type { RoomDocument, PlaceObjectCommand } from '@officexr/world/scenes';

function makeCmd(id: string, position: [number, number, number]): PlaceObjectCommand {
  return { id, op: 'placeObject', kindId: 'block-grass', position };
}

function makeDoc(commands: PlaceObjectCommand[]): RoomDocument {
  return { ...emptyRoomDocument('test'), commands };
}

describe('computeMovedPositions', () => {
  // 1. single object +X
  it('single object +X — delta [1,0,0] on one object at [0,0,0] → result position [1,0,0]', () => {
    const doc = makeDoc([makeCmd('a', [0, 0, 0])]);
    const selectedIds = new Set(['a']);
    const result = computeMovedPositions(doc, selectedIds, [1, 0, 0]);
    expect(result).not.toBeNull();
    expect(result!.get('a')).toEqual([1, 0, 0]);
  });

  // 2. multi-object
  it('multi-object — 3 objects at different positions, same delta applied → all shift by delta', () => {
    const doc = makeDoc([
      makeCmd('a', [0, 0, 0]),
      makeCmd('b', [3, 0, 1]),
      makeCmd('c', [5, 2, 4]),
    ]);
    const selectedIds = new Set(['a', 'b', 'c']);
    const delta: [number, number, number] = [2, 1, 3];
    const result = computeMovedPositions(doc, selectedIds, delta);
    expect(result).not.toBeNull();
    expect(result!.get('a')).toEqual([2, 1, 3]);
    expect(result!.get('b')).toEqual([5, 1, 4]);
    expect(result!.get('c')).toEqual([7, 3, 7]);
  });

  // 3. negative delta
  it('negative delta — delta [-2, 0, -1] → positions decrease correctly', () => {
    const doc = makeDoc([makeCmd('a', [5, 0, 3])]);
    const selectedIds = new Set(['a']);
    const result = computeMovedPositions(doc, selectedIds, [-2, 0, -1]);
    expect(result).not.toBeNull();
    expect(result!.get('a')).toEqual([3, 0, 2]);
  });

  // 4. Y-axis delta
  it('Y-axis delta — delta [0,3,0] → only Y changes', () => {
    const doc = makeDoc([makeCmd('a', [4, 0, 7])]);
    const selectedIds = new Set(['a']);
    const result = computeMovedPositions(doc, selectedIds, [0, 3, 0]);
    expect(result).not.toBeNull();
    expect(result!.get('a')).toEqual([4, 3, 7]);
  });

  // 5. missing commandId
  it('missing commandId — if one selected id is not in doc.commands → returns null', () => {
    const doc = makeDoc([makeCmd('a', [0, 0, 0])]);
    const selectedIds = new Set(['a', 'missing-id']);
    const result = computeMovedPositions(doc, selectedIds, [1, 0, 0]);
    expect(result).toBeNull();
  });

  // 6. preserves other coords
  it('preserves other coords — non-delta dimensions unchanged', () => {
    const doc = makeDoc([makeCmd('a', [10, 5, 8])]);
    const selectedIds = new Set(['a']);
    const result = computeMovedPositions(doc, selectedIds, [0, 0, 3]);
    expect(result).not.toBeNull();
    // X and Y unchanged, Z increases by 3
    expect(result!.get('a')).toEqual([10, 5, 11]);
  });
});
