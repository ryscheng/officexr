/**
 * BotPool.respawnAll regressions. Covers:
 *   - empty pool is a no-op
 *   - bots cycle through spawn points modulo their count
 *   - empty spawn array falls back to the perimeter ring (bots don't
 *     stack at origin)
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  createInMemoryChannelHub,
  InMemoryChannel,
} from '@officexr/sdk';
import { BotPool } from './BotPool.ts';

describe('BotPool.respawnAll', () => {
  let hub: ReturnType<typeof createInMemoryChannelHub>;
  let pool: BotPool;

  beforeEach(() => {
    hub = createInMemoryChannelHub();
    pool = new BotPool({
      createChannel: (botId) => new InMemoryChannel(hub, botId),
      localPlayerId: 'local-player',
    });
  });

  afterEach(() => {
    pool.stop();
  });

  it('empty pool is a no-op', () => {
    expect(() =>
      pool.respawnAll([
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ]),
    ).not.toThrow();
    expect(pool.count()).toBe(0);
  });

  it('teleports each bot to a spawn (modulo) — 2 bots, 1 spawn', async () => {
    await pool.setCount(2);
    expect(pool.count()).toBe(2);
    pool.respawnAll([{ x: 7, y: 0, z: 3 }]);
    for (const bot of pool.list()) {
      const p = bot.getBotPos();
      expect(p.x).toBeCloseTo(7);
      expect(p.z).toBeCloseTo(3);
    }
  });

  it('cycles spawn array — 3 bots, 2 spawns alternate', async () => {
    await pool.setCount(3);
    pool.respawnAll([
      { x: 1, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
    ]);
    const bots = pool.list();
    expect(bots[0].getBotPos().x).toBeCloseTo(1);
    expect(bots[1].getBotPos().x).toBeCloseTo(5);
    expect(bots[2].getBotPos().x).toBeCloseTo(1); // wraps
  });

  it('empty spawn array uses the perimeter-ring fallback', async () => {
    await pool.setCount(2);
    pool.respawnAll([]);
    // Two bots on the ring shouldn't share a position.
    const a = pool.list()[0].getBotPos();
    const b = pool.list()[1].getBotPos();
    const dist = Math.hypot(a.x - b.x, a.z - b.z);
    expect(dist).toBeGreaterThan(0.5);
  });
});
