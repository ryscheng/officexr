import { describe, expect, it } from 'vitest';
import { planarDistance, relativeBearing } from './relativeGeometry.ts';

const origin = { x: 0, y: 0, z: 0 };
const at = (x: number, z: number) => ({ x, y: 0, z });

describe('planarDistance', () => {
  it('ignores y', () => {
    expect(planarDistance(origin, { x: 3, y: 40, z: 4 })).toBe(5);
  });
});

describe('relativeBearing', () => {
  // yaw 0 faces -z; its right is +x.
  const cases: [string, number, ReturnType<typeof at>, number][] = [
    ['ahead', 0, at(0, -5), 0],
    ['right', 0, at(5, 0), Math.PI / 2],
    ['left', 0, at(-5, 0), -Math.PI / 2],
    ['behind', 0, at(0, 5), Math.PI],
    ['ahead after turning left', Math.PI / 2, at(-5, 0), 0],
    ['right after turning left', Math.PI / 2, at(0, -5), Math.PI / 2],
    ['left after turning around', Math.PI, at(5, 0), -Math.PI / 2],
    ['ahead across the wrap', 3 * Math.PI, at(0, 5), 0],
    ['right across the wrap', -3 * Math.PI, at(-5, 0), Math.PI / 2],
  ];
  it.each(cases)('%s', (_name, viewYaw, target, expected) => {
    expect(relativeBearing(origin, viewYaw, target)).toBeCloseTo(expected, 9);
  });

  it('stays within (-π, π]', () => {
    for (let yaw = -7; yaw <= 7; yaw += 0.37) {
      for (const target of [at(1, 0), at(-1, 0), at(0, 1), at(0, -1), at(2, 3)]) {
        const b = relativeBearing(origin, yaw, target);
        expect(b).toBeGreaterThan(-Math.PI);
        expect(b).toBeLessThanOrEqual(Math.PI);
      }
    }
  });

  it('is measured from selfPos', () => {
    expect(relativeBearing(at(10, 10), 0, at(10, 5))).toBeCloseTo(0, 9);
  });
});
