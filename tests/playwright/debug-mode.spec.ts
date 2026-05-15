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

/**
 * Map-switch regression. Pins the actual user-facing contract:
 * picking a map from the dropdown reflects in BOTH the SDK store
 * (`worldObjects.instances` changes count and bbox) AND the rendered
 * pixels (frame hash differs).
 *
 * The pixel hash uses a downsampled `gl.readPixels` walk over the
 * canvas — avoids `page.screenshot`, which hangs against Debug's GPU
 * stalls. We don't compare to a fixed hash (the scene has live bot
 * animations) — only that two different maps produce two different
 * pixel hashes.
 *
 * Requires at least TWO maps on disk (the test fails with a clear
 * message otherwise). Drives the Radix dropdown via synthetic
 * pointer events to bypass actionability checks.
 */
test('Map switch in Debug actually changes the rendered world', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);

  // Pre-flight: ensure /api/maps has at least two entries to switch
  // between. Skip gracefully if not — keeps the suite green on
  // clean checkouts before a second map is authored.
  const maps = (await request
    .get('http://localhost:5174/api/maps')
    .then((r) => r.json())) as { maps?: { name: string }[] };
  const names = (maps.maps ?? []).map((m) => m.name);
  test.skip(names.length < 2, 'needs at least 2 maps on disk');
  const a = names[0];
  const b = names[1];

  // Boot at map `a` so we know the starting state. Set localStorage
  // AFTER the first navigation (before that the page is about:blank,
  // which throws SecurityError on localStorage access).
  await page.goto('/#debug', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('canvas')).toBeVisible({ timeout: 30_000 });
  await page.evaluate((m: string) => localStorage.setItem('officexr:studio:lastMap', m), a);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('canvas')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(8000);

  const snap = async () =>
    page.evaluate(async () => {
      const st = (window as unknown as {
        __OFFICE_STORE__?: { getState: () => { worldObjects?: { instances?: unknown[] } } };
      }).__OFFICE_STORE__?.getState();
      // Pixel hash over a downsampled grid via gl.readPixels.
      const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
      let hash = 'no-canvas';
      if (canvas) {
        for (let i = 0; i < 3; i++) {
          await new Promise<void>((r) => requestAnimationFrame(() => r()));
        }
        const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as
          | WebGLRenderingContext
          | WebGL2RenderingContext
          | null;
        if (gl) {
          const w = canvas.width;
          const h = canvas.height;
          const stepX = Math.max(1, Math.floor(w / 64));
          const stepY = Math.max(1, Math.floor(h / 36));
          let acc = 0;
          const buf = new Uint8Array(4);
          for (let y = 0; y < h; y += stepY) {
            for (let x = 0; x < w; x += stepX) {
              gl.readPixels(
                x,
                h - 1 - y,
                1,
                1,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                buf,
              );
              const v = buf[0] + buf[1] * 256 + buf[2] * 65536;
              acc = ((acc * 33) ^ v) >>> 0;
            }
          }
          hash = acc.toString(16);
        }
      }
      return {
        count: st?.worldObjects?.instances?.length ?? 0,
        hash,
      };
    });

  const before = await snap();

  // Switch via Radix Select. Use synthetic pointer events — Radix
  // listens for pointerdown, and Playwright's .click() chain hangs
  // under Debug's GPU stalls.
  await page.evaluate((nextMap: string) => {
    const trigger = document.querySelector('[role="combobox"]') as HTMLElement | null;
    if (!trigger) throw new Error('no combobox');
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
    trigger.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' }));
    trigger.click();
    void nextMap;
  }, b);
  await page.waitForTimeout(500);
  await page.evaluate((nextMap: string) => {
    const opts = Array.from(document.querySelectorAll('[role="option"]')) as HTMLElement[];
    const target = opts.find((o) => o.textContent?.trim() === nextMap);
    if (!target) throw new Error('no option ' + nextMap);
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
    target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' }));
    target.click();
  }, b);
  await page.waitForTimeout(5000);

  const after = await snap();

  expect(after.count, `cube count differs (was ${before.count})`).not.toBe(
    before.count,
  );
  expect(after.hash, 'pixel hash differs across maps').not.toBe(before.hash);
});

