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
  worldObjectsToCuboids,
} from './rules.ts';

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
