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
 * Map-switch regression. Pins THREE invariants in order from
 * "data-only" to "actually drawn pixels":
 *
 *   1. **Store side.** The picker pushes a new WorldObjects via
 *      `actions.setWorldObjects` — `state.worldObjects.instances`
 *      changes count between maps.
 *   2. **Renderer-wiring side.** `<ObjectInstances>` is mounted in
 *      Scene and consumes that snapshot — `window.__OFFICE_OBJECT_
 *      INSTANCES__.storeCount` is non-undefined AND tracks the
 *      store. This is the critical layer the previous test missed:
 *      ObjectInstances was once accidentally dropped from Scene's
 *      JSX, the data side kept working, and visually NOTHING from
 *      the map ever rendered. The marker only exists when the
 *      component is mounted, so an unmounted ObjectInstances makes
 *      this assertion fail immediately.
 *   3. **Pixel side.** Downsampled `gl.readPixels` over the canvas
 *      produces a different hash between maps. Doesn't pin specific
 *      colours (bots/animations move pixels around) but catches the
 *      "frame didn't change at all" failure mode.
 *
 * Requires at least TWO maps on disk; skips gracefully otherwise.
 * Drives the Radix Select via synthetic pointer events to bypass
 * Playwright actionability checks (which hang under Debug's GPU
 * stalls).
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
      // ObjectInstances writes this marker on every render. If
      // it's `undefined`, ObjectInstances is unmounted (the bug
      // class we just fixed).
      const rendered = (window as unknown as {
        __OFFICE_OBJECT_INSTANCES__?: {
          storeCount: number;
          perKind: Array<{ kindId: string; count: number }>;
        };
      }).__OFFICE_OBJECT_INSTANCES__;
      return {
        count: st?.worldObjects?.instances?.length ?? 0,
        renderedCount: rendered?.storeCount ?? null,
        renderedPerKind: rendered?.perKind ?? null,
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

  // (1) Store delta.
  expect(after.count, `store cube count differs (was ${before.count})`).not.toBe(
    before.count,
  );

  // (2) Renderer-wiring invariant: ObjectInstances IS mounted and
  // reflects the store. Without this, the previous version of this
  // test passed even when ObjectInstances was missing from Scene
  // entirely (the data side was correct; nothing rendered the
  // cubes). If either side of this assertion is `null` or stale,
  // the bug class is back.
  expect(
    before.renderedCount,
    '<ObjectInstances> mounted on map A (window.__OFFICE_OBJECT_INSTANCES__ set)',
  ).toBe(before.count);
  expect(
    after.renderedCount,
    '<ObjectInstances> mounted on map B (window.__OFFICE_OBJECT_INSTANCES__ set)',
  ).toBe(after.count);
  expect(
    after.renderedCount,
    'rendered count tracks store delta between maps',
  ).not.toBe(before.renderedCount);

  // (3) Pixel-side sanity check — frames differ across maps.
  expect(after.hash, 'pixel hash differs across maps').not.toBe(before.hash);
});

/**
 * Deterministic visual regression: pin the local player to a fixed
 * world position (so the fixed-camera is identical between
 * snapshots), silence bots, then mutate `state.worldObjects`
 * directly via the store. Take two pixel buffers — one with no
 * cubes, one with a 21×21 cube grid around the player — and count
 * pixels that DIFFER. With everything else pinned, the only
 * frame-to-frame difference is the cube field.
 *
 * Why pixel-diff (not colour-filtering): the rendered cube is
 * lit/shadowed GLTF, so its on-screen colour fluctuates across
 * face/normal. Counting "blue-ish" pixels misses dark-shaded faces
 * and double-counts the background gradient. A diff approach
 * doesn't care what colour the cubes are — only that the cube
 * region changed between snapshots.
 *
 * Why pin player + silence bots: the player's spawn position
 * determines the fixed-camera angle, and the in-browser bot pool
 * animates idle motions that drift between frames. Without pinning,
 * the diff would include camera-pan deltas + bot anim deltas, and a
 * broken renderer (e.g. ObjectInstances unmounted) would look like
 * any other frame change. Pinning forces the diff to be cube-only.
 *
 * Catches:
 *   - ObjectInstances unmounted: marker undefined → fail.
 *   - ObjectInstances mounted but inert (subscription doesn't fire,
 *     snapshot pinned at empty): cube-buffer matches empty-buffer
 *     pixel-by-pixel → diff is tiny → fail.
 *   - Future regressions of "renderer forgot to consume
 *     state.worldObjects".
 */
test('Rendered cube field actually tracks state.worldObjects (deterministic)', async ({
  page,
}) => {
  test.setTimeout(120_000);

  await page.goto('/#debug', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('canvas')).toBeVisible({ timeout: 30_000 });
  // Reset persisted state so this test always starts from a clean
  // default (no view-config overrides from earlier sessions).
  await page.evaluate(() => {
    localStorage.removeItem('officexr:studio:view-config');
    localStorage.setItem('officexr:studio:lastMap', 'default');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('canvas')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(10_000);

  // Silence bots so their idle animations don't add pixel diffs.
  await page.evaluate(async () => {
    const bots = (window as unknown as { __OFFICE_BOTS__?: { setCount: (n: number) => Promise<void> } }).__OFFICE_BOTS__;
    if (bots) await bots.setCount(0);
  });
  await page.waitForTimeout(1500);

  // Pin the local player so the fixed-camera is identical across
  // snapshots. Camera position is a pure function of player.pos +
  // (azimuth, pitch, height) — pinning pos pins camera.
  const pinPlayer = async () =>
    page.evaluate(() => {
      const store = (window as unknown as {
        __OFFICE_STORE__: {
          getState: () => any;
          setState: (updater: (s: any) => any) => void;
        };
      }).__OFFICE_STORE__;
      store.setState((s: any) => ({
        players: {
          ...s.players,
          [s.selfId]: {
            ...s.players[s.selfId],
            pos: { x: 10, y: 0, z: 10 },
            vel: { x: 0, y: 0, z: 0 },
            yaw: 0,
          },
        },
      }));
    });
  await pinPlayer();
  await page.waitForTimeout(800);

  /** Capture the canvas framebuffer as a base64-encoded RGBA buffer
   * so we can pass it back to the next page.evaluate for diffing. */
  const captureFrame = async () =>
    page.evaluate(async () => {
      const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
      if (!canvas) throw new Error('no canvas');
      // Settle a few frames so post-setState renders have committed.
      for (let i = 0; i < 5; i++) {
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
      }
      const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as
        | WebGLRenderingContext
        | WebGL2RenderingContext
        | null;
      if (!gl) throw new Error('no gl');
      const w = canvas.width;
      const h = canvas.height;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      // Stash on window so the diff step can pick it up.
      (window as unknown as { __FRAME__?: Uint8Array }).__FRAME__ = px;
      return { w, h, len: px.length };
    });

  // Frame A: empty world.
  await page.evaluate(() => {
    (window as unknown as { __OFFICE_STORE__: any }).__OFFICE_STORE__.setState(
      () => ({ worldObjects: { cubeSize: 2, instances: [] } }),
    );
  });
  await pinPlayer();
  await page.waitForTimeout(2500);
  const meta = await captureFrame();
  await page.evaluate(() => {
    (window as unknown as { __FRAME_A__?: Uint8Array; __FRAME__?: Uint8Array }).__FRAME_A__ = (
      window as unknown as { __FRAME__?: Uint8Array }
    ).__FRAME__;
  });

  // Frame B: 21×21 blue cubes around the player.
  await page.evaluate(() => {
    const insts: Array<{
      id: string;
      sourceCommandId: string;
      kindId: string;
      position: [number, number, number];
    }> = [];
    for (let x = 0; x < 21; x++) {
      for (let z = 0; z < 21; z++) {
        insts.push({
          id: `regression-${x}-${z}`,
          sourceCommandId: 'regression',
          kindId: 'colored_block_blue',
          position: [x, 0, z],
        });
      }
    }
    (window as unknown as { __OFFICE_STORE__: any }).__OFFICE_STORE__.setState(
      () => ({ worldObjects: { cubeSize: 2, instances: insts } }),
    );
  });
  await pinPlayer();
  await page.waitForTimeout(2500);
  await captureFrame();

  // Marker check: ObjectInstances IS mounted and reflects the
  // current store state. Catches the bug class "renderer forgot
  // to mount ObjectInstances" in <50 ms.
  const marker = await page.evaluate(
    () =>
      (
        window as unknown as {
          __OFFICE_OBJECT_INSTANCES__?: { storeCount: number };
        }
      ).__OFFICE_OBJECT_INSTANCES__,
  );
  expect(
    marker?.storeCount,
    'ObjectInstances mounted and reflects 441-cube store snapshot',
  ).toBe(441);

  // Diff frame A vs frame B in browser memory.
  const diff = await page.evaluate(() => {
    const a = (window as unknown as { __FRAME_A__?: Uint8Array }).__FRAME_A__;
    const b = (window as unknown as { __FRAME__?: Uint8Array }).__FRAME__;
    if (!a || !b || a.length !== b.length) {
      return { diffs: 0, total: 0 };
    }
    let diffs = 0;
    for (let i = 0; i < a.length; i += 4) {
      const dr = Math.abs(a[i] - b[i]);
      const dg = Math.abs(a[i + 1] - b[i + 1]);
      const db = Math.abs(a[i + 2] - b[i + 2]);
      // Threshold of 30 catches lit-cube vs floor while tolerating
      // anti-aliasing / lighting jitter on the edges.
      if (dr + dg + db > 30) diffs++;
    }
    return { diffs, total: a.length / 4 };
  });
  const ratio = diff.diffs / Math.max(1, diff.total);
  console.log(
    `pixel diff: ${diff.diffs}/${diff.total} (${(ratio * 100).toFixed(1)}%) [canvas ${meta.w}x${meta.h}]`,
  );

  // With player + camera + bots pinned, the only thing that can
  // change the frame is the cube field. A 21×21 cube grid filling
  // the centre of the view should change >5 % of pixels — well
  // above the noise floor (sub-pixel anti-aliasing jitter is
  // <0.5 %). An ObjectInstances-not-rendering bug produces ~0 %
  // diff.
  expect(
    ratio,
    `pixel-diff ratio between empty and 441-cube frames (got ${(ratio * 100).toFixed(2)}%)`,
  ).toBeGreaterThan(0.05);
});
