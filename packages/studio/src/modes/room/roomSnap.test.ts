import { describe, it, expect } from 'vitest';
import {
  computeTileStep,
  computeKindTileSteps,
  quantizeAxisAlignedNormal,
  snapToNearestTileableFace,
  snapToVoxel,
  type CubeHit,
  type FloorHit,
  type TileableObjectInfo,
} from './roomSnap.ts';

describe('computeTileStep', () => {
  it('2m object on 0.5m grid → step 4', () => {
    expect(computeTileStep(2.0, 0.5)).toBe(4);
  });

  it('small object below voxelSize → step 1', () => {
    expect(computeTileStep(0.3, 0.5)).toBe(1);
  });

  it('exactly 1m on 0.5m grid → step 2', () => {
    expect(computeTileStep(1.0, 0.5)).toBe(2);
  });
});

describe('computeKindTileSteps', () => {
  it('computes per-axis steps from dims', () => {
    const steps = computeKindTileSteps({ width: 2.0, height: 2.0, depth: 2.0 }, 0.5);
    expect(steps).toEqual({ x: 4, y: 4, z: 4 });
  });

  it('minimum step is 1 for small dims', () => {
    const steps = computeKindTileSteps({ width: 0.2, height: 0.3, depth: 0.4 }, 0.5);
    expect(steps).toEqual({ x: 1, y: 1, z: 1 });
  });
});

describe('snapToVoxel stepped floor hit', () => {
  function floorHit(x: number, z: number): FloorHit {
    return { kind: 'floor', point: { x, y: 0, z } };
  }

  it('step 4 snaps to multiples of 4 — hit x=2.3, voxelSize=0.5 → voxel x=4', () => {
    // round(2.3/0.5/4)*4 = round(1.15)*4 = 1*4 = 4
    const result = snapToVoxel(floorHit(2.3, 0), 0.5, { x: 4, y: 1, z: 1 });
    expect(result[0]).toBe(4);
  });

  it('step 1 is same as existing behavior', () => {
    // With step {x:1,y:1,z:1} should match unstep behavior
    expect(snapToVoxel(floorHit(0, 0), 2, { x: 1, y: 1, z: 1 })).toEqual([0, 0, 0]);
    expect(snapToVoxel(floorHit(2.1, -3.9), 2, { x: 1, y: 1, z: 1 })).toEqual([1, 0, -2]);
  });

  it('without step parameter, behaves as before', () => {
    expect(snapToVoxel(floorHit(0, 0), 2)).toEqual([0, 0, 0]);
    expect(snapToVoxel(floorHit(4, 4), 2)).toEqual([2, 0, 2]);
  });
});

describe('quantizeAxisAlignedNormal', () => {
  it('returns +x for an x-dominant normal', () => {
    expect(quantizeAxisAlignedNormal([0.98, 0.1, -0.15])).toEqual([1, 0, 0]);
  });

  it('returns -x for a negative x-dominant normal', () => {
    expect(quantizeAxisAlignedNormal([-0.95, 0.2, 0.1])).toEqual([-1, 0, 0]);
  });

  it('returns +y for a y-dominant normal (typical "top of cube")', () => {
    expect(quantizeAxisAlignedNormal([0.05, 0.99, -0.1])).toEqual([0, 1, 0]);
  });

  it('returns -y for a -y-dominant normal (bottom of cube)', () => {
    expect(quantizeAxisAlignedNormal([0.0, -1.0, 0.0])).toEqual([0, -1, 0]);
  });

  it('returns +z for a z-dominant normal', () => {
    expect(quantizeAxisAlignedNormal([0.05, 0.0, 0.98])).toEqual([0, 0, 1]);
  });

  it('defaults to +x on a degenerate all-zero normal', () => {
    // Should never happen with a real raycast hit; the test pins the
    // tie-break behavior. `>=` on each axis means the first conditional
    // (x dominance) wins ties, and `Math.sign(0) === 0` triggers the
    // `s === 0 ? 1 : s` fallback.
    expect(quantizeAxisAlignedNormal([0, 0, 0])).toEqual([1, 0, 0]);
  });
});

describe('snapToVoxel (floor hit)', () => {
  function floorHit(x: number, z: number): FloorHit {
    return { kind: 'floor', point: { x, y: 0, z } };
  }

  it('rounds the floor hit to integer voxel coords with y = 0', () => {
    expect(snapToVoxel(floorHit(0, 0), 2)).toEqual([0, 0, 0]);
    expect(snapToVoxel(floorHit(2.1, -3.9), 2)).toEqual([1, 0, -2]);
    // -1.0 / 2 = -0.5 and Math.round(-0.5) → 0 in JS (rounds toward
    // +∞ for half-values). Pins the JS-rounding behavior so we don't
    // accidentally substitute Math.floor.
    expect(snapToVoxel(floorHit(-1.0, 1.0), 2)).toEqual([-0, 0, 1]);
    expect(snapToVoxel(floorHit(-1.6, 1.0), 2)).toEqual([-1, 0, 1]);
  });

  it('respects the voxelSize divisor', () => {
    expect(snapToVoxel(floorHit(4, 4), 4)).toEqual([1, 0, 1]);
    expect(snapToVoxel(floorHit(4, 4), 2)).toEqual([2, 0, 2]);
  });
});

describe('snapToVoxel (cube hit)', () => {
  function cubeHit(
    cubePosition: [number, number, number],
    faceNormal: [number, number, number],
    kindId = 'colored_block_blue',
  ): CubeHit {
    return { kind: 'cube', cubePosition, faceNormal, kindId };
  }

  it('snaps to the +y voxel above a top-face hit (no stride → 1-voxel step)', () => {
    expect(
      snapToVoxel(cubeHit([3, 0, 7], [0.01, 0.99, 0.02]), 2),
    ).toEqual([3, 1, 7]);
  });

  it('snaps to the +x voxel right of an east-face hit (no stride)', () => {
    expect(
      snapToVoxel(cubeHit([0, 0, 0], [1.0, 0.0, 0.0]), 2),
    ).toEqual([1, 0, 0]);
  });

  it('snaps to the -z voxel north of a back-face hit (no stride)', () => {
    expect(
      snapToVoxel(cubeHit([5, 2, 1], [0.0, 0.0, -1.0]), 2),
    ).toEqual([5, 2, 0]);
  });

  it('voxelSize does not affect cube-hit snapping (already in voxel coords)', () => {
    expect(
      snapToVoxel(cubeHit([10, 0, 10], [0, 1, 0]), 100),
    ).toEqual([10, 1, 10]);
  });

  it('targetStride moves the placement past the target footprint on +X', () => {
    // 2 m cube at voxel (0,0,0) on a 0.5 m grid → stride 4 on each
    // axis. Hit +X face → new position should be (4, 0, 0), not (1).
    expect(
      snapToVoxel(
        cubeHit([0, 0, 0], [1.0, 0.0, 0.0]),
        0.5,
        undefined,
        { x: 4, y: 4, z: 4 },
      ),
    ).toEqual([4, 0, 0]);
  });

  it('targetStride moves the placement past the target footprint on -Z', () => {
    expect(
      snapToVoxel(
        cubeHit([8, 0, 8], [0.0, 0.0, -1.0]),
        0.5,
        undefined,
        { x: 4, y: 4, z: 4 },
      ),
    ).toEqual([8, 0, 4]);
  });

  it('targetStride only multiplies the active axis; unrelated axes pass through', () => {
    // +Y hit: targetStride.y = 4 → step up 4 voxels. X/Z keep target position.
    expect(
      snapToVoxel(
        cubeHit([2, 0, 6], [0, 1, 0]),
        0.5,
        undefined,
        { x: 4, y: 4, z: 4 },
      ),
    ).toEqual([2, 4, 6]);
  });
});

describe('snapToNearestTileableFace', () => {
  const VS = 0.5; // voxelSize

  // 1. fallback — no tileable objects → world grid snap
  it('fallback — no tileable objects → world grid snap', () => {
    // hit at {x: 1.3, y: 0, z: 0.8}, voxelSize=0.5 → round(1.3/0.5)=3, round(0.8/0.5)=2
    const result = snapToNearestTileableFace(
      { x: 1.3, y: 0, z: 0.8 },
      { width: 0.5, height: 0.5, depth: 0.5 },
      [],
      VS,
    );
    expect(result).toEqual([3, 0, 2]);
  });

  // 2. fallback — nearest tileable > fallbackRadiusM → world grid snap
  it('fallback — nearest tileable > fallbackRadiusM away → world grid snap', () => {
    const farObject: TileableObjectInfo = {
      position: [100, 0, 100],
      dims: { width: 2, height: 2, depth: 2 },
    };
    const result = snapToNearestTileableFace(
      { x: 0, y: 0, z: 0 },
      { width: 0.5, height: 0.5, depth: 0.5 },
      [farObject],
      VS,
      5,
    );
    // Should fall back to world grid snap at origin → [0,0,0]
    expect(result).toEqual([0, 0, 0]);
  });

  // 3. flush — chair snaps to +X face of adjacent block
  it('flush — non-tileable snaps to +X face of adjacent block', () => {
    // Block at voxel [0,0,0] with dims 2m×2m×2m, voxelSize=0.5
    // World AABB center x=0, +X face at x = 0 + 2/2 = 1
    // Hit point at {x: 1.1, y: 1.0, z: 0} — at middle height so Y faces are farther
    // +X face dist = |1.1 - 1.0| = 0.1 (closest)
    // Chair dims 0.5m×0.5m×0.5m
    // Flush alignment: chair's -X face at world x=1 → center x = 1 + 0.25 = 1.25 → voxel 3
    const block: TileableObjectInfo = {
      position: [0, 0, 0],
      dims: { width: 2, height: 2, depth: 2 },
    };
    const result = snapToNearestTileableFace(
      { x: 1.1, y: 1.0, z: 0 },
      { width: 0.5, height: 0.5, depth: 0.5 },
      [block],
      VS,
    );
    // Chair center x: faceX + nw/2 = 1.0 + 0.25 = 1.25 → voxel round(1.25/0.5) = round(2.5) = 3
    expect(result[0]).toBe(3);
  });

  // 4. flush — object snaps to top (+Y) face of block below
  it('flush — object snaps to top (+Y) face of block below', () => {
    // Block at [0,0,0] with dims 2m×2m×2m, voxelSize=0.5
    // +Y face of block: world y = 0*0.5 + 2 = 2
    // Hit at {x: 0, y: 1.2, z: 0} — near the top face
    // Non-tileable dims: 0.5m×0.5m×0.5m
    // Placed with -Y face at world y=2 → center y = 2 + 0.5/2 = 2.25 → voxel y = round(2.25/0.5) = round(4.5) = 5
    const block: TileableObjectInfo = {
      position: [0, 0, 0],
      dims: { width: 2, height: 2, depth: 2 },
    };
    const result = snapToNearestTileableFace(
      { x: 0, y: 1.2, z: 0 },
      { width: 0.5, height: 0.5, depth: 0.5 },
      [block],
      VS,
    );
    // y = round((2 + 0.25)/0.5) = round(4.5) = 5 in JS
    expect(result[1]).toBe(5);
  });

  // 5. second nearest is NOT chosen
  it('second nearest tileable is not chosen', () => {
    const closer: TileableObjectInfo = {
      position: [0, 0, 0],
      dims: { width: 2, height: 2, depth: 2 },
    };
    const farther: TileableObjectInfo = {
      position: [20, 0, 0],
      dims: { width: 2, height: 2, depth: 2 },
    };
    // Hit very close to the near block (+X face at x=1)
    const resultWithBoth = snapToNearestTileableFace(
      { x: 1.1, y: 0, z: 0 },
      { width: 0.5, height: 0.5, depth: 0.5 },
      [closer, farther],
      VS,
    );
    const resultWithOnly = snapToNearestTileableFace(
      { x: 1.1, y: 0, z: 0 },
      { width: 0.5, height: 0.5, depth: 0.5 },
      [closer],
      VS,
    );
    expect(resultWithBoth).toEqual(resultWithOnly);
  });
});
