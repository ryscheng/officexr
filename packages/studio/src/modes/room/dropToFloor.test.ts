/**
 * TDD tests for dropToSurface — written BEFORE implementation.
 */
import { describe, it, expect } from 'vitest';
import { dropToSurface } from './dropToSurface.ts';

type WorldObjects = {
  voxelSize: number;
  instances: ReadonlyArray<{ position: readonly [number, number, number] }>;
};

function makeWorld(
  positions: Array<[number, number, number]>,
): WorldObjects {
  return {
    voxelSize: 0.5,
    instances: positions.map((position) => ({ position })),
  };
}

describe('dropToSurface', () => {
  // 1. Empty world → null (no support)
  it('empty world — no instances → null (placement rejected)', () => {
    const world = makeWorld([]);
    expect(dropToSurface([0, 5, 0], { w: 1, d: 1 }, world)).toBeNull();
  });

  // 2. Lands on top of single block at y=3
  it('lands on top of single block at y=3 → [0, 4, 0]', () => {
    const world = makeWorld([[0, 3, 0]]);
    expect(dropToSurface([0, 10, 0], { w: 1, d: 1 }, world)).toEqual([0, 4, 0]);
  });

  // 3. Lands on the highest block when stacked
  it('lands on highest block when stacked — objects at y=0 and y=2 → settled y=3', () => {
    const world = makeWorld([[0, 0, 0], [0, 2, 0]]);
    expect(dropToSurface([0, 10, 0], { w: 1, d: 1 }, world)).toEqual([0, 3, 0]);
  });

  // 4. XZ out of footprint → null
  it('XZ out of footprint — object at [5,3,0], proposed at [0,10,0] → null', () => {
    const world = makeWorld([[5, 3, 0]]);
    expect(dropToSurface([0, 10, 0], { w: 1, d: 1 }, world)).toBeNull();
  });

  // 5. Object at or above proposed Y is ignored
  it('object at or above proposed Y is ignored → null', () => {
    const world = makeWorld([[0, 15, 0]]);
    expect(dropToSurface([0, 10, 0], { w: 1, d: 1 }, world)).toBeNull();
  });

  // 6. Multi-voxel footprint matches correctly
  it('multi-voxel footprint {w:4,d:4} — object at [1,2,1] is within footprint → settled y=3', () => {
    // Footprint centered at [8,10,8]: XZ span [6,10) × [6,10)
    // Instance at [7, 2, 7] is within footprint
    const world = makeWorld([[7, 2, 7]]);
    const result = dropToSurface([8, 10, 8], { w: 4, d: 4 }, world);
    expect(result).toEqual([8, 3, 8]);
  });

  // 7. Multi-voxel footprint does not match out-of-range instance → null
  it('multi-voxel footprint {w:4,d:4} at [8,10,8] — object at [0,5,0] outside → null', () => {
    const world = makeWorld([[0, 5, 0]]);
    expect(dropToSurface([8, 10, 8], { w: 4, d: 4 }, world)).toBeNull();
  });
});
