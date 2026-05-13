#!/usr/bin/env node
/**
 * Node CLI that runs the {@link BotServer} — a WebSocket realtime
 * server with an in-process bot pool. Pairs with the browser
 * `@officexr/studio`: when the user pushes the Leva count slider to
 * ≥ 2, the browser auto-promotes to ws mode and sends a
 * `bots:set-count` custom frame telling this CLI how many bots to
 * spawn.
 *
 * Usually you don't need to run this manually — studio's vite config
 * mounts `vite-plugin-bots`, which spawns this CLI as a child of the
 * dev server. Use the explicit form when you want the CLI in its own
 * terminal (e.g. for log isolation, or to run it on a different
 * machine):
 *
 *   pnpm --filter @officexr/world bots:start
 *
 * Environment:
 *   REALTIME_PORT         default 8787
 *   REALTIME_PATH         default '/ws'
 *   OFFICE_ID             default 'debug-office' (must match browser)
 *   BOT_COUNT             initial count, default 0
 *   BOT_MODE              initial mode, default 'wander'
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { BotServer } from './bot-server.ts';
import type { BotMode } from './BotDriver.ts';

async function main(): Promise<void> {
  // Bootstrap Rapier's wasm before constructing any physics world.
  // `@dimforge/rapier3d-compat` exposes the runtime through a single
  // async init — everything else (RAPIER.World, KinematicCharacterController,
  // etc.) errors if called before this resolves.
  await RAPIER.init();

  const port = Number(process.env.REALTIME_PORT ?? 8787);
  const path = process.env.REALTIME_PATH ?? '/ws';
  const officeId = process.env.OFFICE_ID ?? 'debug-office';
  const initialMode = (process.env.BOT_MODE ?? 'wander') as BotMode;
  const initialCount = Number(process.env.BOT_COUNT ?? '0');

  const server = new BotServer({
    port,
    path,
    officeId,
    initialMode,
    initialCount: Number.isFinite(initialCount) ? initialCount : 0,
  });

  await server.start();
  console.log(
    `[bots-cli] realtime-server listening on :${port}${path} ` +
      `(office: ${officeId}, mode: ${initialMode}, count: ${initialCount})`,
  );
  if (initialCount <= 0) {
    console.log(
      '[bots-cli] idle — waiting for browser to publish bots:set-count',
    );
  }

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[bots-cli] ${signal} received — shutting down`);
    await server.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[bots-cli] fatal:', err);
  process.exit(1);
});
