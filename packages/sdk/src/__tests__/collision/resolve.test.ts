import { describe, it, expect } from 'vitest';
import { buildCollisionWorld } from '../../collision/world.ts';
import { resolveMovement } from '../../collision/resolve.ts';
import type { WorldMap } from '../../game-state/types.ts';

const WALL = 'wall';
const FLOOR = 'floor';
const RADIUS = 0.4;

function emptyMap(): WorldMap {
  return {
    gridSize: 10,
    cubeSize: 2,
    origin: { x: 0, z: 0 },
    layers: [],
    kinds: {
      [FLOOR]: { id: FLOOR, walkable: true },
      [WALL]: { id: WALL, walkable: false },
    },
  };
}

function withWall(cells: Array<{ i: number; j: number }>): WorldMap {
  return {
    ...emptyMap(),
    layers: [{ kind: WALL, cells }],
  };
}

describe('resolveMovement', () => {
  it('passes through unobstructed movement unchanged', () => {
    const world = buildCollisionWorld(emptyMap());
    const r = resolveMovement({
      from: { x: 0, y: 0, z: 0 },
      to: { x: 1, y: 0, z: 0 },
      charRadius: RADIUS,
      world,
      others: [],
    });
    expect(r.blocked).toBe(false);
    expect(r.pos.x).toBeCloseTo(1);
    expect(r.pos.z).toBeCloseTo(0);
  });

  it('clamps to map edge', () => {
    const world = buildCollisionWorld(emptyMap());
    // gridSize=10, cubeSize=2 → halfExtent=10. Limit = 10 - 0.4 = 9.6
    const r = resolveMovement({
      from: { x: 9, y: 0, z: 0 },
      to: { x: 100, y: 0, z: 0 },
      charRadius: RADIUS,
      world,
      others: [],
    });
    expect(r.blocked).toBe(true);
    expect(r.contact).toBe('bounds');
    expect(r.pos.x).toBeCloseTo(9.6);
  });

  it('blocks head-on collision with a single obstacle cube', () => {
    // Wall at cell (5, 5); centre of cell (5,5) for gridSize=10 is
    // (5 - 4.5)*2 = 1, (5 - 4.5)*2 = 1, so the cube spans [0, 2] × [0, 2].
    const world = buildCollisionWorld(withWall([{ i: 5, j: 5 }]));
    const r = resolveMovement({
      from: { x: -1, y: 0, z: 1 },
      to: { x: 0.5, y: 0, z: 1 }, // would put char inside the cube
      charRadius: RADIUS,
      world,
      others: [],
    });
    expect(r.blocked).toBe(true);
    expect(r.contact).toBe('obstacle');
    // Resolved x must keep char outside the cube's left face (x=0).
    expect(r.pos.x).toBeLessThanOrEqual(0 - RADIUS + 1e-6);
  });

  it('slides along a wall when approached at an angle', () => {
    const world = buildCollisionWorld(withWall([{ i: 5, j: 5 }]));
    // Glance along the south face of the cube (z=0 face) moving east.
    const r = resolveMovement({
      from: { x: -1, y: 0, z: 0.3 },
      to: { x: 1, y: 0, z: 0.5 }, // would clip into the cube on Z
      charRadius: RADIUS,
      world,
      others: [],
    });
    // We expect to slide east along the wall — z should be pushed out, but
    // x should make most of the requested progress.
    expect(r.blocked).toBe(true);
    expect(r.pos.x).toBeGreaterThan(0); // moved east
    expect(r.pos.z).toBeLessThanOrEqual(0 - RADIUS + 1e-6); // pushed off the cube
  });

  it('stops on char-vs-char head-on contact', () => {
    const world = buildCollisionWorld(emptyMap());
    const r = resolveMovement({
      from: { x: 0, y: 0, z: 0 },
      to: { x: 0.5, y: 0, z: 0 },
      charRadius: RADIUS,
      world,
      others: [
        { id: 'b', pos: { x: 1, y: 0, z: 0 }, radius: RADIUS },
      ],
    });
    expect(r.blocked).toBe(true);
    expect(r.contact).toBe('character');
    expect(r.otherId).toBe('b');
    // Resolved char-x must be at or beyond the contact distance.
    expect(r.pos.x).toBeLessThanOrEqual(1 - RADIUS * 2 + 1e-6);
  });

  it('press-into-character while already touching → pos === from', () => {
    const world = buildCollisionWorld(emptyMap());
    // A is exactly touching B from the left.
    const a = { x: 1 - RADIUS * 2, y: 0, z: 0 };
    const r = resolveMovement({
      from: a,
      to: { x: a.x + 0.05, y: 0, z: 0 }, // try to push in
      charRadius: RADIUS,
      world,
      others: [{ id: 'b', pos: { x: 1, y: 0, z: 0 }, radius: RADIUS }],
    });
    expect(r.blocked).toBe(true);
    expect(r.contact).toBe('character');
    // No movement — char-vs-char with no tangent component falls back to from.
    expect(r.pos.x).toBeCloseTo(a.x);
    expect(r.pos.z).toBeCloseTo(a.z);
  });

  it('does not touch y when only XZ collisions occur', () => {
    const world = buildCollisionWorld(emptyMap());
    const r = resolveMovement({
      from: { x: 0, y: 5, z: 0 },
      to: { x: 1, y: 5, z: 0 },
      charRadius: RADIUS,
      world,
      others: [],
    });
    expect(r.pos.y).toBe(5);
  });
});
