import { describe, expect, it } from 'vitest';
import { clientToMap } from './mapPoint';

const box = { x: -10, z: -5, w: 20, h: 10 };

describe('clientToMap', () => {
  it('scales a tight fit', () => {
    expect(clientToMap({ left: 100, top: 50, width: 200, height: 100 }, box, 200, 100)).toEqual({ x: 0, z: 0 });
    expect(clientToMap({ left: 100, top: 50, width: 200, height: 100 }, box, 100, 50)).toEqual({ x: -10, z: -5 });
  });

  it('centres the map in a taller box, so the letterbox margin lands outside it', () => {
    const rect = { left: 0, top: 0, width: 200, height: 200 };
    expect(clientToMap(rect, box, 100, 100)).toEqual({ x: 0, z: 0 });
    expect(clientToMap(rect, box, 0, 10).z).toBeLessThan(box.z);
  });
});
