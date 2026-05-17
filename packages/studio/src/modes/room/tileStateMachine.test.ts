/**
 * TDD tests for tileStateMachine.ts — written BEFORE implementation.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveAvailableAxes,
  computeTileGhosts,
  switchNextAxis,
  type TileAxis,
  type TileMachineState,
} from './tileStateMachine.ts';

describe('resolveAvailableAxes', () => {
  it('all true → [x, y, z]', () => {
    expect(resolveAvailableAxes({ x: true, y: true, z: true })).toEqual(['x', 'y', 'z']);
  });

  it('only X and Z → [x, z]', () => {
    expect(resolveAvailableAxes({ x: true, y: false, z: true })).toEqual(['x', 'z']);
  });

  it('none → []', () => {
    expect(resolveAvailableAxes({ x: false, y: false, z: false })).toEqual([]);
  });

  it('only Y → [y]', () => {
    expect(resolveAvailableAxes({ x: false, y: true, z: false })).toEqual(['y']);
  });
});

describe('computeTileGhosts', () => {
  // 4. idle stage with hover → [hoverVoxel]
  it('idle stage with hover → [hoverVoxel]', () => {
    const state: TileMachineState = { stage: 'idle' };
    const result = computeTileGhosts(state, [1, 0, 2], { x: 1, y: 1, z: 1 });
    expect(result).toEqual([[1, 0, 2]]);
  });

  // 5. idle stage no hover → []
  it('idle stage no hover → []', () => {
    const state: TileMachineState = { stage: 'idle' };
    const result = computeTileGhosts(state, null, { x: 1, y: 1, z: 1 });
    expect(result).toEqual([]);
  });

  // 6. placed, nextAxis X, step 4 — origin [0,0,0], hover [8,0,0]
  it('placed, nextAxis X, step 4 — origin [0,0,0], hover [8,0,0] → ghosts at [4,0,0] and [8,0,0]', () => {
    const state: TileMachineState = {
      stage: 'placed',
      origin: [0, 0, 0],
      kindId: 'block-grass',
      originCommandId: 'cmd-1',
      remainingAxes: ['x', 'z', 'y'],
      nextAxis: 'x',
    };
    const result = computeTileGhosts(state, [8, 0, 0], { x: 4, y: 1, z: 1 });
    // Steps: round(8/4) = 2 steps → ghosts at [4,0,0] and [8,0,0]
    expect(result).toContainEqual([4, 0, 0]);
    expect(result).toContainEqual([8, 0, 0]);
    expect(result).toHaveLength(2);
  });

  // 7. placed, nextAxis Z, step 1 — origin [0,0,0], hover [0,0,3]
  it('placed, nextAxis Z, step 1 — origin [0,0,0], hover [0,0,3] → ghosts at z=1,2,3', () => {
    const state: TileMachineState = {
      stage: 'placed',
      origin: [0, 0, 0],
      kindId: 'block-grass',
      originCommandId: 'cmd-1',
      remainingAxes: ['z', 'y'],
      nextAxis: 'z',
    };
    const result = computeTileGhosts(state, [0, 0, 3], { x: 1, y: 1, z: 1 });
    expect(result).toEqual([[0, 0, 1], [0, 0, 2], [0, 0, 3]]);
  });
});

describe('switchNextAxis', () => {
  // 8. changes to valid axis
  it('changes to valid axis in remainingAxes', () => {
    const state: TileMachineState = {
      stage: 'placed',
      origin: [0, 0, 0],
      kindId: 'block-grass',
      originCommandId: 'cmd-1',
      remainingAxes: ['x', 'z'],
      nextAxis: 'x',
    };
    const result = switchNextAxis(state, 'z');
    expect(result.stage).toBe('placed');
    if (result.stage === 'placed') {
      expect(result.nextAxis).toBe('z');
    }
  });

  // 9. no-op for axis not in remainingAxes
  it('no-op when axis is not in remainingAxes', () => {
    const state: TileMachineState = {
      stage: 'placed',
      origin: [0, 0, 0],
      kindId: 'block-grass',
      originCommandId: 'cmd-1',
      remainingAxes: ['x'],
      nextAxis: 'x',
    };
    const result = switchNextAxis(state, 'y' as TileAxis);
    expect(result).toBe(state); // reference equality — no-op
  });

  // idle state → no-op
  it('idle state → no-op (returned as-is)', () => {
    const state: TileMachineState = { stage: 'idle' };
    const result = switchNextAxis(state, 'x');
    expect(result).toBe(state);
  });
});
