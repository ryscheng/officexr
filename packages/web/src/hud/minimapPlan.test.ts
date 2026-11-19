import { describe, expect, it } from 'vitest';
import type { ObjectInstance } from '@officexr/sdk';
import { buildPlan, planTone } from './minimapPlan';
import { worldPlanTransform } from './minimapGeometry';

describe('planTone', () => {
  it('reads layout pieces as floors or walls by height, and furniture by its flags', () => {
    expect(planTone({ isLayoutObject: true }, 0.1)).toBe('floor');
    expect(planTone({ isLayoutObject: true }, 3)).toBe('wall');
    expect(planTone({ isLayoutObject: false, isDesk: true }, 0.75)).toBe('desk');
    expect(planTone({ isLayoutObject: false, seat: {} }, 1.2)).toBe('seat');
    expect(planTone({ isLayoutObject: false }, 0.05)).toBe('rug');
    expect(planTone(undefined, 1)).toBe('furniture');
  });

  it('reads a solid block under your feet as floor and one rising past them as a wall', () => {
    // 2 m cubes: the floor's top is at y=0, where you stand (store root 0.5 m under the feet).
    expect(planTone({ isLayoutObject: true }, 2, 0, -0.5)).toBe('floor');
    expect(planTone({ isLayoutObject: true }, 2, 2, -0.5)).toBe('wall');
    // A step up still reads as floor; a lower terrace too.
    expect(planTone({ isLayoutObject: true }, 2, 0.4, -0.5)).toBe('floor');
    expect(planTone({ isLayoutObject: true }, 2, -4, -0.5)).toBe('floor');
  });
});

describe('buildPlan', () => {
  const inst = (id: string, kindId: string): ObjectInstance => ({ id, sourceCommandId: id, kindId, position: [0, 0, 0] });
  const boxes: Record<string, { min: number[]; max: number[] }> = {
    wall: { min: [0, 0, 0], max: [4, 3, 0.2] },
    desk: { min: [1, 0, 1], max: [3, 0.75, 2] },
    floor: { min: [-5, -0.1, -5], max: [5, 0, 5] },
  };
  const kinds: Record<string, { isLayoutObject: boolean; isDesk?: boolean }> = {
    wall: { isLayoutObject: true },
    desk: { isLayoutObject: false, isDesk: true },
    floor: { isLayoutObject: true },
  };

  it('lays footprints out back to front: floors under furniture, walls on top', () => {
    const plan = buildPlan([inst('a', 'wall'), inst('b', 'desk'), inst('c', 'floor')], (i) => boxes[i.kindId], (id) => kinds[id]);
    expect(plan.map((r) => r.tone)).toEqual(['floor', 'desk', 'wall']);
    expect(plan[1]).toEqual({ x: 1, z: 1, w: 2, d: 1, tone: 'desk' });
  });

  it('keeps furniture on a floor built from blocks visible, under the walls only', () => {
    const blocks: Record<string, { min: number[]; max: number[] }> = {
      ...boxes,
      floor: { min: [-5, -2, -5], max: [5, 0, 5] },
      wall: { min: [0, 0, 0], max: [4, 2, 2] },
    };
    const plan = buildPlan([inst('a', 'wall'), inst('b', 'desk'), inst('c', 'floor')], (i) => blocks[i.kindId], (id) => kinds[id], -0.5);
    expect(plan.map((r) => r.tone)).toEqual(['floor', 'desk', 'wall']);
  });
});

describe('worldPlanTransform', () => {
  const apply = (m: ReturnType<typeof worldPlanTransform>, x: number, z: number) => ({ x: m.a * x + m.c * z + m.e, y: m.b * x + m.d * z + m.f });

  it('puts you at the centre and scales metres to pixels', () => {
    const m = worldPlanTransform({ x: 3, y: 0, z: -2 }, 0, { rangeM: 40, sizePx: 200, centre: 100 });
    expect(apply(m, 3, -2)).toEqual({ x: 100, y: 100 });
    const ahead = apply(m, 3, -12);
    expect(ahead.x).toBeCloseTo(100);
    expect(ahead.y).toBeCloseTo(50);
  });

  it('turns with the view so what is ahead stays up', () => {
    const yaw = Math.PI / 2;
    const m = worldPlanTransform({ x: 0, y: 0, z: 0 }, yaw, { rangeM: 40, sizePx: 200, centre: 100 });
    // Yaw π/2 faces -X; ten metres that way is straight up the map.
    const ahead = apply(m, -10, 0);
    expect(ahead.x).toBeCloseTo(100);
    expect(ahead.y).toBeCloseTo(50);
  });
});
