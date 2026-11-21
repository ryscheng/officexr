import { describe, expect, it } from 'vitest';
import { headingDegrees, mapBounds, namedPeople, placeRoomLabels, planShape, readPlan } from './mapGeometry';

const room = (id: string, x0: number, z0: number, x1: number, z1: number, label = id) => ({ id, label, min: { x: x0, z: z0 }, max: { x: x1, z: z1 } });

describe('headingDegrees', () => {
  it.each([0, 0.7, Math.PI / 2, -2, 3])('turns the up-pointing arrow to where an avatar with yaw %f walks', (yaw) => {
    const rad = (headingDegrees(yaw) * Math.PI) / 180;
    const arrow = { x: Math.sin(rad), z: -Math.cos(rad) };
    expect(arrow.x).toBeCloseTo(-Math.sin(yaw));
    expect(arrow.z).toBeCloseTo(-Math.cos(yaw));
  });
});

describe('mapBounds', () => {
  it('pads the rooms and the people, and ignores a plan wider than the rooms', () => {
    const box = mapBounds([room('a', 0, 0, 10, 10)], [{ x: 8, z: 8, w: 60, d: 2, tone: 'wall' }], [{ x: -5, z: 4 }]);
    expect(box).toEqual({ x: -8, z: -3, w: 21, h: 16 });
  });

  it('frames the plan when there are no rooms', () => {
    expect(mapBounds([], [{ x: 0, z: 0, w: 10, d: 4, tone: 'wall' }], [])).toEqual({ x: -3, z: -3, w: 16, h: 10 });
  });

  it('has a default box for an empty office', () => {
    expect(mapBounds([], [], [])).toEqual({ x: 0, z: 0, w: 40, h: 40 });
  });
});

describe('planShape', () => {
  it('makes a plant a circle, a desk a rounded box and a wall square', () => {
    expect(planShape({ x: 0, z: 0, w: 0.6, d: 0.6, tone: 'furniture' })).toEqual({ round: true, radius: 0.3 });
    expect(planShape({ x: 0, z: 0, w: 1, d: 1, tone: 'desk' }).round).toBe(false);
    expect(planShape({ x: 0, z: 0, w: 2, d: 0.9, tone: 'seat' })).toEqual({ round: false, radius: 0.2250 });
    expect(planShape({ x: 0, z: 0, w: 4, d: 0.2, tone: 'wall' })).toEqual({ round: false, radius: 0 });
  });
});

describe('placeRoomLabels', () => {
  const lobby = room('lobby', 0, 0, 20, 12, 'Lobby');

  it('puts the name on the top edge when nobody stands there', () => {
    const [label] = placeRoomLabels([lobby], [], 0.1, 12);
    expect(label.x).toBe(10);
    expect(label.z).toBeLessThan(3);
  });

  it('moves the name off a person standing under it', () => {
    const [free] = placeRoomLabels([lobby], [], 0.1, 12);
    const [moved] = placeRoomLabels([lobby], [{ x: free.x, z: free.z }], 0.1, 12);
    expect(Math.hypot(moved.x - free.x, moved.z - free.z)).toBeGreaterThan(2);
  });

  it('keeps two labels apart', () => {
    const [a, b] = placeRoomLabels([lobby, room('twin', 0, 0, 20, 12, 'Twin')], [], 0.1, 12);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(2);
  });

  it('shortens a name that cannot fit its room', () => {
    const [label] = placeRoomLabels([room('s', 0, 0, 2, 2, 'A very long meeting room name')], [], 0.1, 12);
    expect(label.text.endsWith('…')).toBe(true);
  });
});

describe('namedPeople', () => {
  it('drops the name of a person standing next to an earlier one', () => {
    const shown = namedPeople(
      [
        { id: 'a', x: 0, z: 0 },
        { id: 'b', x: 1, z: 0.5 },
        { id: 'c', x: 20, z: 0 },
      ],
      0.1,
    );
    expect([...shown]).toEqual(['a', 'c']);
  });
});

describe('readPlan', () => {
  const block = (x: number, z: number) => ({ x, z, w: 2, d: 2, tone: 'wall' as const });

  it('turns a tiled ground of blocks into floor', () => {
    const grid = Array.from({ length: 16 }, (_, i) => block((i % 4) * 2, Math.floor(i / 4) * 2));
    expect(readPlan(grid).every((r) => r.tone === 'floor')).toBe(true);
  });

  it('keeps thin walls around an open room as walls', () => {
    const walls = [{ x: 0, z: 0, w: 20, d: 0.2, tone: 'wall' as const }, { x: 0, z: 10, w: 20, d: 0.2, tone: 'wall' as const }];
    expect(readPlan(walls)).toBe(walls);
  });
});
