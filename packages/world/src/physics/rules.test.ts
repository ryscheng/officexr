import { describe, expect, it } from 'vitest';
import type { WorldObjects } from '@officexr/sdk';
import {
  GRAVITY,
  MAX_FALL_VELOCITY,
  FLOOR_PROBE_RANGE,
  pickRespawnPosition,
  RESPAWN_MARGIN,
  respawnThreshold,
  shouldRespawnFalling,
  SPAWN_DROP_HEIGHT,
  worldObjectsToColliders,
  worldObjectsToCuboids,
} from './rules.ts';
import { createInstanceGeometry } from '../app/geometry-service.ts';
import type {
  ColliderShapeSpec,
  WorldObjectKind,
} from '../scenes/world-object-kinds-schema.ts';

function inst(x: number, y: number, z: number) {
  return {
    id: `${x},${y},${z}`,
    sourceCommandId: '',
    kindId: 'colored_block_blue',
    position: [x, y, z] as [number, number, number],
  };
}

describe('physics/rules', () => {
  it('GRAVITY is negative — characters fall down, not up', () => {
    expect(GRAVITY).toBeLessThan(0);
  });

  describe('respawnThreshold', () => {
    it('returns -Infinity for an empty world (nothing to fall off)', () => {
      const w: WorldObjects = { cubeSize: 2, instances: [] };
      expect(respawnThreshold(w)).toBe(Number.NEGATIVE_INFINITY);
    });

    it('is RESPAWN_MARGIN below the lowest cube bottom', () => {
      // Cubes at voxel y=0 and y=3 with cubeSize=2.
      // Bottom faces are at world y=0 and y=6. Lowest is y=0.
      // Threshold = 0 - RESPAWN_MARGIN.
      const w: WorldObjects = {
        cubeSize: 2,
        instances: [inst(0, 0, 0), inst(1, 3, 1)],
      };
      expect(respawnThreshold(w)).toBe(-RESPAWN_MARGIN);
    });

    it('handles negative voxel y (cubes below origin)', () => {
      const w: WorldObjects = {
        cubeSize: 2,
        instances: [inst(0, -5, 0)],
      };
      // Lowest cube bottom = -5 * 2 = -10. Threshold = -10 - margin.
      expect(respawnThreshold(w)).toBe(-10 - RESPAWN_MARGIN);
    });

    it('uses spawn-point y as the floor when there are no cubes (baked-layout maps)', () => {
      // The booper map case: room is empty (instances=[]) because the
      // platforms live in a baked GLB collided by `<BakedLayoutColliders>`.
      // Without the spawn-derived fallback, threshold would be -Infinity
      // and the backstop fall check would never fire.
      const w: WorldObjects = { cubeSize: 2, instances: [] };
      expect(respawnThreshold(w, [{ x: 13.5, y: 0.5, z: 1.8 }])).toBe(
        0.5 - RESPAWN_MARGIN,
      );
    });

    it('cube bottom dominates spawn y when both are present (back-compat)', () => {
      // Voxel map where the spawn rests on top of cubes: cube bottom is
      // lower than spawn y, so the existing cube-derived threshold wins.
      const w: WorldObjects = {
        cubeSize: 2,
        instances: [inst(0, 0, 0)], // bottom = 0
      };
      // Spawn y = 1 (sitting on the cube). Lowest floor = 0 (cube bottom).
      expect(respawnThreshold(w, [{ x: 0, y: 1, z: 0 }])).toBe(-RESPAWN_MARGIN);
    });

    it('returns -Infinity when neither source contributes (empty world, no spawns)', () => {
      const w: WorldObjects = { cubeSize: 2, instances: [] };
      expect(respawnThreshold(w, [])).toBe(Number.NEGATIVE_INFINITY);
    });
  });

  describe('worldObjectsToCuboids', () => {
    it('maps voxel coords to world cuboid centers, half-extents = cubeSize/2', () => {
      const w: WorldObjects = {
        cubeSize: 2,
        instances: [inst(3, 0, 5)],
      };
      const out = worldObjectsToCuboids(w);
      expect(out).toHaveLength(1);
      // Center: x = 3 * 2 = 6, y = 0 * 2 + 1 = 1, z = 5 * 2 = 10.
      expect(out[0].center).toEqual({ x: 6, y: 1, z: 10 });
      expect(out[0].halfExtents).toEqual({ x: 1, y: 1, z: 1 });
    });

    it('produces one cuboid per instance', () => {
      const w: WorldObjects = {
        cubeSize: 2,
        instances: [inst(0, 0, 0), inst(1, 0, 0), inst(2, 1, 3)],
      };
      expect(worldObjectsToCuboids(w)).toHaveLength(3);
    });

    it('maps scanned-cuboids (normalized 0..1) through the instance AABB', () => {
      const w: WorldObjects = {
        cubeSize: 2,
        instances: [inst(0, 0, 0)],
      };
      // World AABB: 4 m wide/deep, 2 m tall, based at (10, 0, 20).
      const aabbLookup = () => ({
        min: [10, 0, 20] as const,
        max: [14, 2, 24] as const,
      });
      // One scanned column covering the lower-left quarter footprint
      // at half height: normalized [0,0,0]..[0.5,0.5,0.5].
      const shapeLookup = () => ({
        kind: 'scanned-cuboids' as const,
        cuboids: [
          {
            min: [0, 0, 0] as [number, number, number],
            max: [0.5, 0.5, 0.5] as [number, number, number],
          },
        ],
      });
      const out = worldObjectsToCuboids(w, aabbLookup, shapeLookup);
      expect(out).toHaveLength(1);
      // World box: (10,0,20)..(12,1,22) → center (11, 0.5, 21).
      expect(out[0].center).toEqual({ x: 11, y: 0.5, z: 21 });
      expect(out[0].halfExtents).toEqual({ x: 1, y: 0.5, z: 1 });
    });

    it('emits one world cuboid per scanned cuboid', () => {
      const w: WorldObjects = { cubeSize: 2, instances: [inst(0, 0, 0)] };
      const aabbLookup = () => ({
        min: [0, 0, 0] as const,
        max: [4, 4, 4] as const,
      });
      const shapeLookup = () => ({
        kind: 'scanned-cuboids' as const,
        cuboids: [
          { min: [0, 0, 0], max: [0.25, 0.25, 1] },
          { min: [0.25, 0, 0], max: [0.5, 0.5, 1] },
          { min: [0.5, 0, 0], max: [1, 1, 1] },
        ] as Array<{ min: [number, number, number]; max: [number, number, number] }>,
      });
      const out = worldObjectsToCuboids(w, aabbLookup, shapeLookup);
      expect(out).toHaveLength(3);
      // Ascending tops: 1, 2, 4 (normalized 0.25/0.5/1 of the 4 m AABB).
      const tops = out.map((c) => c.center.y + c.halfExtents.y);
      expect(tops).toEqual([1, 2, 4]);
    });
  });

  describe('yawed instances', () => {
    const VOXEL = 0.5;
    const kinds: Record<string, WorldObjectKind> = {
      wall: { id: 'wall', dimensions: { width: 4, height: 2, depth: 1 } } as WorldObjectKind,
      stairs: { id: 'stairs', dimensions: { width: 2, height: 2, depth: 1 } } as WorldObjectKind,
      ramp: { id: 'ramp', dimensions: { width: 4, height: 2, depth: 1 } } as WorldObjectKind,
      scan: { id: 'scan', dimensions: { width: 2, height: 2, depth: 1 } } as WorldObjectKind,
    };
    const shapes: Record<string, ColliderShapeSpec> = {
      stairs: { kind: 'compound-steps', stepCount: 4, stepRise: 0.5, stepRun: 0.5, stepDepth: 1 },
      ramp: { kind: 'trimesh', positions: [0, 0, 0, 1, 0, 0, 0, 1, 1], indices: [0, 1, 2] },
      scan: { kind: 'scanned-cuboids', cuboids: [{ min: [0, 0, 0], max: [0.25, 0.5, 1] }] },
    };
    const geometry = createInstanceGeometry({
      catalog: { getKind: (id) => kinds[id] },
      voxelSize: VOXEL,
    });
    const colliders = (kindId: string, yawDeg: number) =>
      worldObjectsToColliders(
        {
          cubeSize: VOXEL,
          instances: [{ id: 'a', sourceCommandId: 'a', kindId, position: [2, 0, 4], yawDeg }],
        },
        geometry.worldAABB,
        (id) => shapes[id],
      );

    it('turns a 4×1 wall at yaw 90 into a 1×4 cuboid around the same centre', () => {
      const [flat] = worldObjectsToCuboids(
        {
          cubeSize: VOXEL,
          instances: [{ id: 'a', sourceCommandId: 'a', kindId: 'wall', position: [2, 0, 4] }],
        },
        geometry.worldAABB,
      );
      const [turned] = colliders('wall', 90);
      expect(turned).toEqual({
        type: 'cuboid',
        center: flat.center,
        halfExtents: { x: 0.5, y: 1, z: 2 },
      });
    });

    it.each([
      { yawDeg: 0, dir: [-1, 0] },
      { yawDeg: 90, dir: [0, 1] },
      { yawDeg: 180, dir: [1, 0] },
      { yawDeg: 270, dir: [0, -1] },
    ])('stairs at yaw $yawDeg ascend toward $dir', ({ yawDeg, dir }) => {
      const steps = colliders('stairs', yawDeg).map((c) => {
        if (c.type !== 'cuboid') throw new Error('expected cuboid steps');
        return c;
      });
      const box = geometry.worldAABB([2, 0, 4], 'stairs', yawDeg);
      for (const s of steps) {
        expect(s.center.x - s.halfExtents.x).toBeGreaterThanOrEqual(box.min[0] - 1e-9);
        expect(s.center.x + s.halfExtents.x).toBeLessThanOrEqual(box.max[0] + 1e-9);
        expect(s.center.z - s.halfExtents.z).toBeGreaterThanOrEqual(box.min[2] - 1e-9);
        expect(s.center.z + s.halfExtents.z).toBeLessThanOrEqual(box.max[2] + 1e-9);
      }
      const lowest = steps[0];
      const highest = steps[steps.length - 1];
      expect(highest.halfExtents.y).toBeGreaterThan(lowest.halfExtents.y);
      const run = Math.hypot(
        highest.center.x - lowest.center.x,
        highest.center.z - lowest.center.z,
      );
      expect((highest.center.x - lowest.center.x) / run).toBeCloseTo(dir[0], 9);
      expect((highest.center.z - lowest.center.z) / run).toBeCloseTo(dir[1], 9);
    });

    it('turns scanned cuboids of a non-square kind at yaw 90', () => {
      // Footprint x 1..3, z 2..3 (centre (2, 2.5)); the scan covers
      // x 1..1.5, z 2..3, which a quarter turn maps to x 1.5..2.5, z 3..3.5.
      expect(colliders('scan', 90)).toEqual([
        { type: 'cuboid', center: { x: 2, y: 0.5, z: 3.25 }, halfExtents: { x: 0.5, y: 0.5, z: 0.25 } },
      ]);
    });

    it('rotates slope trimesh vertices about the footprint centre', () => {
      const flat = colliders('ramp', 0)[0];
      const turned = colliders('ramp', 270)[0];
      if (flat.type !== 'trimesh' || turned.type !== 'trimesh') throw new Error('expected trimesh');
      // Footprint x 1..5, z 2..3 → centre (3, 2.5); yaw 270 maps offset (dx, dz) → (−dz, dx).
      const expected: number[] = [];
      for (let i = 0; i < flat.vertices.length; i += 3) {
        const dx = flat.vertices[i] - 3;
        const dz = flat.vertices[i + 2] - 2.5;
        expected.push(3 - dz, flat.vertices[i + 1], 2.5 + dx);
      }
      expect(turned.vertices).toEqual(expected.map((v) => expect.closeTo(v, 9)));
      expect(turned.indices).toEqual(flat.indices);
    });

    it('falls back to one cuboid over the rotated AABB for a 45° shaped kind', () => {
      const box = geometry.worldAABB([2, 0, 4], 'stairs', 45);
      expect(colliders('stairs', 45)).toEqual([
        {
          type: 'cuboid',
          center: {
            x: (box.min[0] + box.max[0]) / 2,
            y: (box.min[1] + box.max[1]) / 2,
            z: (box.min[2] + box.max[2]) / 2,
          },
          halfExtents: {
            x: (box.max[0] - box.min[0]) / 2,
            y: (box.max[1] - box.min[1]) / 2,
            z: (box.max[2] - box.min[2]) / 2,
          },
        },
      ]);
    });
  });

  describe('shouldRespawnFalling', () => {
    it('both gates open — no floor AND velocity at threshold: true', () => {
      // velY = -MAX_FALL_VELOCITY (exactly at threshold), hasFloor = false
      expect(shouldRespawnFalling(-MAX_FALL_VELOCITY, false)).toBe(true);
    });

    it('floor present — should NOT respawn even at high fall speed', () => {
      expect(shouldRespawnFalling(-MAX_FALL_VELOCITY, true)).toBe(false);
    });

    it('velocity below threshold — should NOT respawn even without floor', () => {
      expect(shouldRespawnFalling(-3, false)).toBe(false);
    });

    it('ascending velocity — should NOT respawn', () => {
      expect(shouldRespawnFalling(2, false)).toBe(false);
    });

    it('exactly at threshold (boundary inclusive) — should respawn', () => {
      expect(shouldRespawnFalling(-MAX_FALL_VELOCITY, false)).toBe(true);
    });

    it('just below threshold (velocity -7.99 when threshold is 8) — should NOT respawn', () => {
      expect(shouldRespawnFalling(-(MAX_FALL_VELOCITY - 0.01), false)).toBe(false);
    });
  });

  describe('constants', () => {
    it('MAX_FALL_VELOCITY is positive (represents magnitude of downward speed)', () => {
      expect(MAX_FALL_VELOCITY).toBeGreaterThan(0);
    });

    it('FLOOR_PROBE_RANGE is positive', () => {
      expect(FLOOR_PROBE_RANGE).toBeGreaterThan(0);
    });
  });

  describe('pickRespawnPosition', () => {
    it('returns null when there are no spawns', () => {
      expect(pickRespawnPosition([])).toBeNull();
    });

    it('lifts the chosen spawn by SPAWN_DROP_HEIGHT', () => {
      const r = pickRespawnPosition([{ x: 10, y: 2, z: 10 }]);
      expect(r).toEqual({ x: 10, y: 2 + SPAWN_DROP_HEIGHT, z: 10 });
    });

    it('cycles round-robin by index', () => {
      const list = [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
        { x: 20, y: 0, z: 0 },
      ];
      expect(pickRespawnPosition(list, 0)?.x).toBe(0);
      expect(pickRespawnPosition(list, 1)?.x).toBe(10);
      expect(pickRespawnPosition(list, 4)?.x).toBe(10); // 4 % 3 = 1
    });
  });
});
