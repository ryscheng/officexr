import { describe, it, expect } from 'vitest';
import { dropToSurface } from './dropToSurface.ts';
import type { FootprintOf } from './footprint.ts';
import { CUBE, PEG, WALL, footprintOf } from './__tests__/yawedKinds.ts';

type Vec3 = [number, number, number];

const unit: FootprintOf = (p) => ({ min: p, max: [p[0] + 1, p[1] + 1, p[2] + 1] });
const unitWorld = (positions: Vec3[]) => ({
  instances: positions.map((position) => ({ position, kindId: 'unit' })),
});
const dropUnit = (at: Vec3, positions: Vec3[]) =>
  dropToSurface(at, { kindId: 'unit' }, unitWorld(positions), unit);

describe('dropToSurface', () => {
  it('rejects a drop with nothing below', () => {
    expect(dropUnit([0, 5, 0], [])).toBeNull();
  });

  it('rests one voxel above a single support', () => {
    expect(dropUnit([0, 10, 0], [[0, 3, 0]])).toEqual([0, 4, 0]);
  });

  it('rests on the highest support when stacked', () => {
    expect(dropUnit([0, 10, 0], [[0, 0, 0], [0, 2, 0]])).toEqual([0, 3, 0]);
  });

  it('ignores supports outside the footprint', () => {
    expect(dropUnit([0, 10, 0], [[5, 3, 0]])).toBeNull();
  });

  it('ignores objects at or above the proposed Y', () => {
    expect(dropUnit([0, 10, 0], [[0, 15, 0]])).toBeNull();
  });
});

describe('dropToSurface with yawed supports', () => {
  const dropPegOnWall = (yawDeg: number, at: Vec3) =>
    dropToSurface(
      at,
      { kindId: PEG.id },
      { instances: [{ position: [0, 0, 0], kindId: WALL.id, yawDeg }] },
      footprintOf,
    );

  it('a 4×1 wall at yaw 0 supports along x only', () => {
    expect(dropPegOnWall(0, [3, 10, 0])).toEqual([3, 3, 0]);
    expect(dropPegOnWall(0, [0, 10, 2])).toBeNull();
  });

  it('a 4×1 wall at yaw 90 supports as 1×4: x [2,3), z [-1,3)', () => {
    expect(dropPegOnWall(90, [2, 10, 0])).toEqual([2, 3, 0]);
    expect(dropPegOnWall(90, [2, 10, 2])).toEqual([2, 3, 2]);
    expect(dropPegOnWall(90, [0, 10, 0])).toBeNull();
    expect(dropPegOnWall(90, [3, 10, 0])).toBeNull();
    expect(dropPegOnWall(90, [2, 10, 3])).toBeNull();
  });

  it('a wall at yaw 180 supports like yaw 0, and at yaw 270 like yaw 90', () => {
    expect(dropPegOnWall(180, [3, 10, 0])).toEqual([3, 3, 0]);
    expect(dropPegOnWall(180, [2, 10, 2])).toBeNull();
    expect(dropPegOnWall(270, [2, 10, -1])).toEqual([2, 3, -1]);
    expect(dropPegOnWall(270, [3, 10, 0])).toBeNull();
  });
});

describe('dropToSurface rests on supports under the whole dropped footprint', () => {
  const drop = (dropped: { kindId: string; yawDeg?: number }, ...pegs: Vec3[]) =>
    dropToSurface(
      [0, 10, 0],
      dropped,
      { instances: pegs.map((position) => ({ position, kindId: PEG.id })) },
      footprintOf,
    );
  const turnedWall = { kindId: WALL.id, yawDeg: 90 };

  it('a 4×1 wall dropped at yaw 90 lands as 1×4 on a support under any of its cells', () => {
    // The wall at [0,10,0] yaw 90 covers x [2,3), z [-1,3).
    for (const z of [-1, 0, 1, 2]) {
      expect(drop(turnedWall, [2, 0, z])).toEqual([0, 1, 0]);
    }
    expect(drop(turnedWall, [3, 0, 0])).toBeNull();
    expect(drop(turnedWall, [2, 0, 3])).toBeNull();
    // Unturned, the same wall spans x [0,4) at z 0 and misses the off-axis support.
    expect(drop({ kindId: WALL.id }, [2, 0, 2])).toBeNull();
  });

  it('a wall dropped at yaw 270 covers the same cells as yaw 90, and yaw 180 as yaw 0', () => {
    expect(drop({ kindId: WALL.id, yawDeg: 270 }, [2, 0, -1])).toEqual([0, 1, 0]);
    expect(drop({ kindId: WALL.id, yawDeg: 270 }, [3, 0, 0])).toBeNull();
    expect(drop({ kindId: WALL.id, yawDeg: 180 }, [3, 0, 0])).toEqual([0, 1, 0]);
    expect(drop({ kindId: WALL.id, yawDeg: 180 }, [2, 0, 2])).toBeNull();
  });

  it('an unrotated 4×4 object lands on a support under a non-anchor cell', () => {
    expect(drop({ kindId: CUBE.id }, [3, 0, 3])).toEqual([0, 1, 0]);
    expect(drop({ kindId: CUBE.id }, [4, 0, 0])).toBeNull();
  });

  it('takes the highest support across the footprint', () => {
    expect(drop({ kindId: CUBE.id }, [0, 0, 0], [3, 2, 1])).toEqual([0, 3, 0]);
  });
});
