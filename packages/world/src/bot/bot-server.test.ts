import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WORLD_CONSTANTS, type WorldConstants } from '@officexr/sdk';
import { BotServer } from './bot-server.ts';

const TOKEN = 'secret-token';

function constantsWithSpeed(playerSpeed: number): WorldConstants {
  return {
    ...DEFAULT_WORLD_CONSTANTS,
    animation: { ...DEFAULT_WORLD_CONSTANTS.animation, playerSpeed },
  };
}

describe('BotServer world constants', () => {
  let server: BotServer | null = null;

  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  it('running bots follow a PUT and later bots start with it', async () => {
    const port = 50000 + Math.floor(Math.random() * 10000);
    server = new BotServer({ port, adminToken: TOKEN });
    await server.start();
    await server.pool.setCount(1);
    const speedOf = (i: number) => server!.pool.list()[i].getWorldConstants()?.animation.playerSpeed;
    expect(speedOf(0)).toBe(DEFAULT_WORLD_CONSTANTS.animation.playerSpeed);

    const res = await fetch(`http://127.0.0.1:${port}/admin/world-constants`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(constantsWithSpeed(9)),
    });
    expect(res.status).toBe(204);
    await vi.waitFor(() => expect(speedOf(0)).toBe(9));

    await server.pool.setCount(2);
    expect(speedOf(1)).toBe(9);
  });
});
