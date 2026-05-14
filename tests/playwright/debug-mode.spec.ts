/**
 * Debug mode regressions. The Debug page mounts the full multiplayer
 * Scene with the SDK store, bots, and physics — it's the heaviest tree
 * in the studio.
 *
 * Pins:
 *   - Canvas mounts with positive dimensions.
 *   - SDK store mirror on `window` has the local player + a bot.
 *
 * Pixel-level checks (e.g. "character meshes visible") were attempted
 * but `page.evaluate` + WebGL readPixels chains hang against the Debug
 * page — the Rapier+Physics+bot-pool boot saturates the main thread
 * and GPU stalls compound. Visual regressions like the "leash math
 * pushed the character out of frame" bug were diagnosed by checking
 * in screenshots manually. If we get a flakier-but-cheap visual check
 * working, add it back here.
 */

import { expect, test } from '@playwright/test';
import { goToMode } from './helpers.ts';

test('Debug mode mounts a canvas, the SDK store has both the local player and a bot', async ({
  page,
}) => {
  test.setTimeout(60_000);

  await goToMode(page, 'debug');

  let attempts = 0;
  type State = {
    canvasW: number;
    canvasH: number;
    hasStore: boolean;
    selfId: string | null;
    playerCount: number;
  };
  let state: State | null = null;
  while (attempts < 30) {
    attempts++;
    // eslint-disable-next-line no-await-in-loop
    state = (await page.evaluate(() => {
      const c = document.querySelector('canvas');
      type Store = { getState: () => { selfId?: string; players?: object } };
      const store = (window as unknown as { __OFFICE_STORE__?: Store })
        .__OFFICE_STORE__;
      const s = store?.getState();
      return {
        canvasW: c?.clientWidth ?? 0,
        canvasH: c?.clientHeight ?? 0,
        hasStore: !!store,
        selfId: s?.selfId ?? null,
        playerCount: Object.keys(s?.players ?? {}).length,
      };
    })) as State;
    if (
      state.canvasW > 100 &&
      state.canvasH > 100 &&
      state.hasStore &&
      state.playerCount > 0
    ) {
      break;
    }
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(500);
  }

  expect(state).not.toBeNull();
  expect(state!.canvasW, 'canvas width').toBeGreaterThan(100);
  expect(state!.canvasH, 'canvas height').toBeGreaterThan(100);
  expect(state!.hasStore, 'SDK store mirror on window').toBe(true);
  expect(state!.selfId, 'local player id').toBe('local-player');
  expect(state!.playerCount, 'player count (self + at least one bot)').toBeGreaterThan(1);
});
