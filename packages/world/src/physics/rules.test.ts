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
