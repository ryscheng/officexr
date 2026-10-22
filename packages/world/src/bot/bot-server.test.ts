import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_WORLD_CONSTANTS, type WorldConstants } from '@officexr/sdk';
import { BotServer } from './bot-server.ts';

const TOKEN = 'secret-token';

function constantsWithSpeed(playerSpeed: number): WorldConstants {
  return {
    ...DEFAULT_WORLD_CONSTANTS,
    animation: { ...DEFAULT_WORLD_CONSTANTS.animation, playerSpeed },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('waitFor: predicate did not become true');
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
    await waitFor(() => speedOf(0) === 9);

    await server.pool.setCount(2);
    expect(speedOf(1)).toBe(9);
  });
});
