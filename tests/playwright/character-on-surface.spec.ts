/**
 * Mugshot-style integration test: render each character on a 2×2 cube
 * square with gravity + the kinematic character controller, freeze
 * the animation mixer at bind pose (`paused={true}`), and assert the
 * rendered frame against a committed baseline PNG.
 *
 * Goal: pin "character actually stands ON the cube surface" as a
 * regression target. The scene reuses the exact same `<Scene>` and
 * `<MapColliders>` Debug uses; the only behavioral knob is the new
 * `paused` prop which disables the AnimationMixer. If the character
 * placement math regresses (feet sink into the floor, hover too
 * high, etc.), the diff highlights the foot region and the test
 * fails with `*-actual.png` + `*-diff.png` attached.
 *
 * Baselines live in `character-on-surface.spec.ts-snapshots/`.
 * Regenerate with:
 *   pnpm exec playwright test character-on-surface --update-snapshots
 * Review each PNG by hand before committing — a bad baseline
 * preserves the bug forever.
 */
import { test, expect } from '@playwright/test';
import { waitForCanvasReady } from './helpers.ts';

const CHARACTERS = [
  'Barbarian',
  'Knight',
  'Mage',
  'Ranger',
  'Rogue',
  'Rogue_Hooded',
] as const;

const SELF_ID = 'mugshot-player';
// The Rapier body's ROOT y after the character is DROPPED onto the
// mugshot cube cluster and SETTLES under gravity (no teleport). The
// cluster's cubes are aligned to the global VOXEL_SIZE=0.5 so their
// tops sit at world y=1; the ball collider sits at local y = BODY_Y
// (0.9) with radius `charRadius` (0.4), so ball bottom = root.y + 0.5
// and geometric contact is root = 1 - 0.5 = 0.50. The Mugshot threads
// a near-zero character-controller skin (MUGSHOT_CONTROLLER_OFFSET, vs
// gameplay's 0.01) so the gravity-settle lands feet-flush at ≈0.50
// rather than floating ~1 cm. Measured settle: ≈0.5002.
const SETTLED_BODY_Y = 0.5;

for (const character of CHARACTERS) {
  test(`mugshot: ${character} stands on 2x2 cube surface`, async ({ page }) => {
    test.setTimeout(90_000);

    await page.goto(`/#mugshot/${character}`, {
      waitUntil: 'domcontentloaded',
    });

    // Canvas mount + initial GLTF loads + Vite cold start. The
    // actual gravity-settle happens after.
    await waitForCanvasReady(page, 0, 30_000);

    // Wait for the kinematic body to land on the cube surface. The
    // mugshot drops the player from y=SPAWN_DROP_HEIGHT (4) onto cubes
    // whose tops are at y=1; with GRAVITY=-20 and geometric contact at
    // body-root y=0.5, the settle takes a handful of frames after the
    // initial fall (~0.5 s for the drop + a tick or two for
    // `computedGrounded()` to zero vertical velocity). Cap at 8 s for
    // cold-cache safety.
    await page.waitForFunction(
      ({ selfId, settledY }: { selfId: string; settledY: number }) => {
        const store = (
          window as unknown as {
            __OFFICE_STORE__?: {
              getState: () => {
                players: Record<
                  string,
                  { pos: { x: number; y: number; z: number }; vel: { x: number; y: number; z: number } } | undefined
                >;
              };
            };
          }
        ).__OFFICE_STORE__;
        if (!store) return false;
        const p = store.getState().players[selfId];
        if (!p) return false;
        // Body root within 5 cm of the settled value AND vertical
        // velocity zeroed by computedGrounded().
        return Math.abs(p.pos.y - settledY) < 0.05 && Math.abs(p.vel.y) < 0.001;
      },
      { selfId: SELF_ID, settledY: SETTLED_BODY_Y },
      { timeout: 8_000, polling: 100 },
    );

    // Settle one more beat so the shadow camera + post-effect chain
    // converges after the body stops moving. The directional-light
    // shadow camera follows the player; it takes a frame or two
    // after movement halts for the shadow map to stabilize.
    await page.waitForTimeout(400);

    // Numeric pre-assertions: fail fast (and informatively) if the
    // SDK side regresses before we even get to the pixel diff. These
    // catch "renderer didn't mount the character" or "gravity didn't
    // run" cleanly.
    const settled = await page.evaluate((selfId: string) => {
      const store = (
        window as unknown as {
          __OFFICE_STORE__: {
            getState: () => {
              players: Record<
                string,
                { pos: { x: number; y: number; z: number }; vel: { x: number; y: number; z: number } }
              >;
              worldObjects: { instances: unknown[] };
            };
          };
        }
      ).__OFFICE_STORE__;
      const state = store.getState();
      return {
        playerY: state.players[selfId]?.pos.y,
        playerVelY: state.players[selfId]?.vel.y,
        cubeCount: state.worldObjects.instances.length,
      };
    }, SELF_ID);
    expect(settled.cubeCount).toBe(4);
    expect(settled.playerY).toBeGreaterThan(SETTLED_BODY_Y - 0.05);
    expect(settled.playerY).toBeLessThan(SETTLED_BODY_Y + 0.05);
    expect(Math.abs(settled.playerVelY ?? 1)).toBeLessThan(0.001);

    // Pixel-diff against the committed baseline. Target just the
    // canvas element — Mugshot mode now renders into a fixed-pixel
    // 512×512 container, so the canvas locator captures exactly
    // the scene render and the surrounding control panel layout
    // can change without breaking baselines.
    const canvas = page.locator('canvas').first();
    await expect(canvas).toHaveScreenshot(`mugshot-${character}.png`, {
      maxDiffPixels: 200,
      threshold: 0.15,
      animations: 'disabled',
    });
  });
}
