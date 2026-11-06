import { describe, expect, it } from 'vitest';
import { snapDeskAreaBounds } from '../deskAreaGeometry.ts';

describe('snapDeskAreaBounds', () => {
  it('snaps corners to 0.5 m and orders them regardless of drag direction', () => {
    expect(snapDeskAreaBounds({ x: 3.3, z: 2.1 }, { x: 0.8, z: -0.4 })).toEqual({
      min: { x: 1, z: -0.5 },
      max: { x: 3.5, z: 2 },
    });
  });

  it('rejects a rectangle with no area', () => {
    expect(snapDeskAreaBounds({ x: 1.1, z: 1 }, { x: 1.2, z: 4 })).toBeNull();
  });
});
