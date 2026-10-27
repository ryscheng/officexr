/**
 * Debug mode covers the world with a loading screen until the map, its
 * models and its baked-layout colliders have loaded, and only then adds
 * the local player — so the player lands on the floor instead of falling
 * through a world that isn't there yet.
 *
 * scenario-stairs is a baked-layout map: its floor colliders come from the
 * baked GLB, which loads independently of the rest of the scene.
 */
import { test, expect } from '@playwright/test';
import { distinctColorsInCanvas } from './helpers.ts';
import { goToDebugWithMap } from './motion-helpers.ts';

const SELF_ID = 'local-player';
const SPAWN_Y = 2;
/** Body root rests 0.5 m below the feet, which stand on the spawn platform at y=2. */
const SETTLED_BODY_Y = 1.5;
const MAX_DROP_BELOW_SPAWN = 0.55;

interface Sample {
  loading: boolean;
  y: number | null;
}

test('Debug holds the player behind the loading screen until the world is ready', async ({ page }) => {
  test.setTimeout(60_000);

  // Sample every frame from boot, so the first frames after the screen goes are caught.
  await page.addInitScript((selfId: string) => {
    const w = window as unknown as {
      __SAMPLES__: Sample[];
      __OFFICE_STORE__?: { getState: () => { players: Record<string, { pos: { y: number } } | undefined> } };
    };
    w.__SAMPLES__ = [];
    const tick = () => {
      w.__SAMPLES__.push({
        loading: document.querySelector('[data-testid="world-loading"]') !== null,
        y: w.__OFFICE_STORE__?.getState().players[selfId]?.pos.y ?? null,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, SELF_ID);

  await goToDebugWithMap(page, 'scenario-stairs');

  const loading = page.locator('[data-testid="world-loading"]');
  await expect(loading).toBeVisible({ timeout: 20_000 });
  await expect(loading).toHaveCount(0, { timeout: 30_000 });

  await page.waitForFunction(
    ({ selfId, settledY }: { selfId: string; settledY: number }) => {
      const p = (
        window as unknown as {
          __OFFICE_STORE__: {
            getState: () => { players: Record<string, { pos: { y: number }; vel: { y: number } } | undefined> };
          };
        }
      ).__OFFICE_STORE__.getState().players[selfId];
      return p !== undefined && Math.abs(p.pos.y - settledY) < 0.05 && Math.abs(p.vel.y) < 0.001;
    },
    { selfId: SELF_ID, settledY: SETTLED_BODY_Y },
    { timeout: 8_000, polling: 100 },
  );

  const samples = await page.evaluate(() => (window as unknown as { __SAMPLES__: Sample[] }).__SAMPLES__);
  const firstShown = samples.findIndex((s) => s.loading);
  expect(firstShown, 'the loading screen showed before anything else').toBeGreaterThanOrEqual(0);
  const afterScreen = samples.slice(firstShown).filter((s) => !s.loading && s.y !== null);
  expect(afterScreen.length).toBeGreaterThan(0);
  const lowest = Math.min(...afterScreen.map((s) => s.y as number));
  expect(lowest, `lowest self y after the screen went (${lowest})`).toBeGreaterThanOrEqual(
    SPAWN_Y - MAX_DROP_BELOW_SPAWN,
  );

  const colors = await distinctColorsInCanvas(page.locator('canvas').first());
  expect(colors, 'the world is still drawn after the loading screen goes').toBeGreaterThan(20);
});
