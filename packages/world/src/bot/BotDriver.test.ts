import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createInMemoryChannelHub,
  InMemoryChannel,
} from '@officexr/sdk';
import { FakeClock } from '@officexr/sdk/test-harness';
import { BotDriver } from './BotDriver.ts';

const START_POS = { x: 10, y: 0, z: 0 };
const LOCAL_POS = { x: 0, y: 0, z: 0 };

describe('BotDriver', () => {
  let hub: ReturnType<typeof createInMemoryChannelHub>;
  let clock: FakeClock;
  let bot: BotDriver;

  beforeEach(() => {
    hub = createInMemoryChannelHub();
    clock = new FakeClock(0);
    bot = new BotDriver({
      createChannel: (botId) => new InMemoryChannel(hub, botId),
      localPlayerId: 'local-player',
      startPos: START_POS,
      clock,
    });
  });

  afterEach(() => {
    bot.stop();
  });

  it('initial position: after start(), getBotPos() equals startPos', async () => {
    await bot.start();
    const pos = bot.getBotPos();
    expect(pos.x).toBeCloseTo(START_POS.x);
    expect(pos.y).toBeCloseTo(START_POS.y);
    expect(pos.z).toBeCloseTo(START_POS.z);
  });

  it('idle mode does not move: tick 5 times, position unchanged', async () => {
    await bot.start();
    bot.setMode('idle');
    for (let i = 0; i < 5; i++) {
      bot.tick(100);
    }
    const pos = bot.getBotPos();
    expect(pos.x).toBeCloseTo(START_POS.x);
    expect(pos.z).toBeCloseTo(START_POS.z);
  });

  it('walk-to-local moves bot closer to local player', async () => {
    await bot.start();
    const initialDist = Math.sqrt(
      (START_POS.x - LOCAL_POS.x) ** 2 + (START_POS.z - LOCAL_POS.z) ** 2
    );
    bot.setMode('walk-to-local');
    for (let i = 0; i < 10; i++) {
      bot.tick(100);
    }
    const pos = bot.getBotPos();
    const newDist = Math.sqrt(
      (pos.x - LOCAL_POS.x) ** 2 + (pos.z - LOCAL_POS.z) ** 2
    );
    expect(newDist).toBeLessThan(initialDist);
  });

  it('walk-away moves bot farther from local player', async () => {
    hub = createInMemoryChannelHub();
    clock = new FakeClock(0);
    const startNear = { x: 2, y: 0, z: 0 };
    bot = new BotDriver({
      createChannel: (botId) => new InMemoryChannel(hub, botId),
      localPlayerId: 'local-player',
      startPos: startNear,
      clock,
    });
    await bot.start();
    bot.setMode('walk-away');
    for (let i = 0; i < 5; i++) {
      bot.tick(100);
    }
    const pos = bot.getBotPos();
    expect(pos.x).toBeGreaterThan(2);
  });

  it('stop is safe: start then stop then tick causes no throw', async () => {
    await bot.start();
    bot.stop();
    expect(() => bot.tick(100)).not.toThrow();
  });

  it('bot broadcasts position to hub after tick in walk-to-local mode', async () => {
    // Create a spy channel on the same hub
    const spyChannel = new InMemoryChannel(hub, 'spy-client');
    const received: unknown[] = [];
    await spyChannel.subscribe();
    spyChannel.on((event) => {
      received.push(event);
    });

    await bot.start();
    bot.setMode('walk-to-local');
    bot.tick(100);

    // Give async delivery a tick
    await new Promise((r) => setTimeout(r, 0));

    spyChannel.close();
    expect(received.length).toBeGreaterThan(0);
  });
});
