/**
 * Debug mode regressions. The Debug page mounts the full multiplayer
 * Scene with the SDK store, bots, and physics — it's the heaviest tree
 * in the studio. Any silent break here is invisible to unit tests.
 *
 * Approach: probe the SDK store directly via `window.__OFFICE_STORE__`
 * (set by DebugApp) + the rendered DOM via `evaluate`. We deliberately
 * avoid Playwright's `screenshot` / `boundingBox` here — they wait on
 * font load + framebuffer state and tend to hang on the Debug page
 * during boot (Rapier wasm + Physics + bot pool saturate the main
 * thread for several seconds).
 */

import { expect, test } from '@playwright/test';
import { goToMode } from './helpers.ts';

test('Debug mode mounts a canvas, the SDK store has both the local player and a bot', async ({
  page,
}) => {
  test.setTimeout(60_000);

  await goToMode(page, 'debug');

  // Poll the page state until both the canvas and the SDK store are
  // populated. Avoids Playwright auto-actions that wait for fonts.
  let attempts = 0;
  let state: {
    canvasW: number;
    canvasH: number;
    hasStore: boolean;
    selfId: string | null;
    playerCount: number;
  } | null = null;
  while (attempts < 30) {
    attempts++;
    // eslint-disable-next-line no-await-in-loop
    state = await page.evaluate(() => {
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
    });
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
