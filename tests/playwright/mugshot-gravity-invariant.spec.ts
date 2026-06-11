/**
 * GRAVITY PLACEMENT INVARIANT — the load-bearing guard for the Mugshot.
 *
 * officexr places the Mugshot character by GRAVITY, not by an offset:
 * the body is dropped from above the cubes and settles onto them under
 * the kinematic character controller. The ONLY sanctioned vertical
 * compensation is the near-zero controller skin
 * (`MUGSHOT_CONTROLLER_OFFSET` in MugshotApp), which makes the settle
 * land feet-flush instead of floating ~1 cm on gameplay's 0.01 skin.
 * It is self-limiting: a controller skin can only float the body UP,
 * never sink it below contact, so it physically cannot mask a large
 * gravity float.
 *
 * THE INVARIANT: after settling, the character's feet must rest within
 * MAX_GROUND_SINK (10 cm) of the cube surface. If this fails, gravity
 * handling has regressed — DO NOT "fix" it by raising MAX_GROUND_SINK,
 * adding a position offset, or re-introducing the old teleport-to-
 * constant. Open a bug-finding mission and repair the placement so
 * gravity once again settles the character on the surface.
 *
 * Geometry: cube tops at world y=1; ball collider bottom = body root +
 * (BODY_Y - charRadius) = root + 0.5. So feet world-y = settled root +
 * 0.5, and the deviation from the surface is |(root + 0.5) - 1|.
 */
import { test, expect } from '@playwright/test';
import { waitForCanvasReady } from './helpers.ts';

const SELF_ID = 'mugshot-player';

/** Hard cap on how far gravity may leave the feet from the surface.
 * Exceeding it is a bug in gravity/placement, never a reason to grow
 * this number. */
const MAX_GROUND_SINK = 0.1; // metres (10 cm)

/** World y of the cube tops in the mugshot scene (2×2 cluster, tops at
 * y=1). */
const SURFACE_TOP_Y = 1.0;
/** Ball-bottom offset above the body root: BODY_Y(0.9) - charRadius(0.4). */
const FEET_ABOVE_ROOT = 0.5;

for (const mode of ['gltf', 'primitive'] as const) {
  test(`mugshot gravity invariant · feet within 10cm of surface · ${mode}`, async ({
    page,
  }) => {
    test.setTimeout(60_000);

    await page.goto('/#mugshot/Barbarian', { waitUntil: 'domcontentloaded' });
    await waitForCanvasReady(page, 0, 30_000);

    // Select cube mode (both must settle the character on a real surface).
    await page.waitForFunction(
      () =>
        typeof (window as unknown as Record<string, unknown>)
          .__OFFICE_MUGSHOT_SET_CUBE_MODE__ === 'function',
      null,
      { timeout: 15_000 },
    );
    await page.evaluate((m) => {
      (
        window as unknown as {
          __OFFICE_MUGSHOT_SET_CUBE_MODE__: (m: string) => void;
        }
      ).__OFFICE_MUGSHOT_SET_CUBE_MODE__(m);
    }, mode);

    // Wait for the body to fall and settle: vertical store velocity ≈ 0
    // and pos.y stops changing.
    await page.waitForFunction(
      (selfId: string) => {
        const store = (
          window as unknown as {
            __OFFICE_STORE__?: {
              getState: () => {
                players: Record<
                  string,
                  { pos: { y: number }; vel: { y: number } } | undefined
                >;
              };
            };
          }
        ).__OFFICE_STORE__;
        if (!store) return false;
        const p = store.getState().players[selfId];
        return !!p && p.pos.y < 2 && Math.abs(p.vel.y) < 1e-3;
      },
      SELF_ID,
      { timeout: 12_000, polling: 100 },
    );
    await page.waitForTimeout(400);

    const rootY = await page.evaluate((selfId: string) => {
      return (
        window as unknown as {
          __OFFICE_STORE__: {
            getState: () => {
              players: Record<string, { pos: { y: number } } | undefined>;
            };
          };
        }
      ).__OFFICE_STORE__.getState().players[selfId]?.pos.y;
    }, SELF_ID);

    expect(rootY, 'settled body root y not exposed').not.toBeUndefined();
    const feetY = (rootY as number) + FEET_ABOVE_ROOT;
    const sink = Math.abs(feetY - SURFACE_TOP_Y);

    expect(
      sink,
      `GRAVITY HANDLING REGRESSED (${mode}): character settled with feet ${(
        sink * 100
      ).toFixed(1)} cm from the cube surface (root=${rootY}, feet=${feetY}, ` +
        `surface=${SURFACE_TOP_Y}). This exceeds MAX_GROUND_SINK=${MAX_GROUND_SINK *
          100} cm. Do NOT raise this cap or add a position offset — open a ` +
        `bug-finding mission and fix gravity placement so the character settles ` +
        `on the surface again.`,
    ).toBeLessThanOrEqual(MAX_GROUND_SINK);
  });
}
