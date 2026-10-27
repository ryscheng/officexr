import { describe, it, expect } from 'vitest';
import { PlayerGrid } from '../../spatial/player-grid.ts';
import type { PlayerState } from '../../game-state/types.ts';

function fakePlayer(id: string, x: number, z: number): PlayerState {
  return {
    id,
    name: id,
    pos: { x, y: 0, z },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    hp: 100,
    isDead: false,
    isAirborne: false,
    avatar: { model: 'default' },
    jitsiRoom: null,
    status: 'active',
  };
}

function bruteForceWithinRadius(
  players: Record<string, PlayerState>,
  x: number,
  z: number,
  radius: number,
): Set<string> {
  const r2 = radius * radius;
  const hits = new Set<string>();
  for (const id in players) {
    const dx = players[id].pos.x - x;
    const dz = players[id].pos.z - z;
    if (dx * dx + dz * dz <= r2) hits.add(id);
  }
  return hits;
}

describe('PlayerGrid', () => {
  it('rejects non-positive cellSize', () => {
    expect(() => new PlayerGrid(0)).toThrow();
    expect(() => new PlayerGrid(-1)).toThrow();
  });

  it('returns superset of brute-force matches', () => {
    const players: Record<string, PlayerState> = {
      a: fakePlayer('a', 0, 0),
      b: fakePlayer('b', 1, 0),
      c: fakePlayer('c', 5, 5),
      d: fakePlayer('d', -3, 2),
    };
    const grid = PlayerGrid.fromPlayers(players, 2);
    const truth = bruteForceWithinRadius(players, 0, 0, 2);
    const fromGrid = new Set<string>();
    grid.forEachInRadius(0, 0, 2, (id) => {
      // Filter by precise distance — grid is broad-phase, callers do the
      // exact check themselves, just like in the proximity / bump rules.
      const p = players[id];
      const dx = p.pos.x;
      const dz = p.pos.z;
      if (dx * dx + dz * dz <= 4) fromGrid.add(id);
    });
    expect(fromGrid).toEqual(truth);
  });

  it('handles negative coordinates without missing buckets', () => {
    const players: Record<string, PlayerState> = {
      a: fakePlayer('a', -100, -100),
      b: fakePlayer('b', -100.5, -99.5),
      c: fakePlayer('c', 0, 0),
    };
    const grid = PlayerGrid.fromPlayers(players, 2);
    const seen: string[] = [];
    grid.forEachInRadius(-100, -100, 1.5, (id) => seen.push(id));
    expect(seen.sort()).toEqual(['a', 'b']);
  });

  it('large radius pulls in players from many cells', () => {
    const players: Record<string, PlayerState> = {};
    for (let i = -5; i <= 5; i++) {
      for (let j = -5; j <= 5; j++) {
        const id = `p${i},${j}`;
        players[id] = fakePlayer(id, i * 2, j * 2);
      }
    }
    const grid = PlayerGrid.fromPlayers(players, 2);
    const radius = 4;
    const hits: string[] = [];
    grid.forEachInRadius(0, 0, radius, (id) => {
      const p = players[id];
      const d2 = p.pos.x * p.pos.x + p.pos.z * p.pos.z;
      if (d2 <= radius * radius) hits.push(id);
    });
    const truth = bruteForceWithinRadius(players, 0, 0, radius);
    expect(new Set(hits)).toEqual(truth);
  });
});
