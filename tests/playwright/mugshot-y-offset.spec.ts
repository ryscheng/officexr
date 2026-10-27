/**
 * Regression for the Mugshot Y-offset slider. The slider is the
 * primary live diagnostic for "is my character placed correctly on
 * the cube?" — if its plumbing breaks, the human loses the ability
 * to surface placement bugs interactively.
 *
 * The Y-offset slider is a MANUAL DIAGNOSTIC OVERRIDE for a human
 * inspecting placement — officexr itself never relies on it; gravity
 * places the character. By default (`manualPlacement === false`)
 * gravity owns the body and it settles ≈0.50. Driving
 * `__OFFICE_MUGSHOT_SET_Y_OFFSET__` flips into manual mode: gravity is
 * SUSPENDED and the body is pinned at the slider value.
 *
 * Asserts that pushing a new Y through that hook reaches
 * `store.players[selfId].pos.y` within a few frames. The state path:
 *   __OFFICE_MUGSHOT_SET_Y_OFFSET__(y)
 *     → setManualPlacement(true) + setYOffset(y)
 *     → gravity effect calls __OFFICE_GRAVITY__.setEnabled(false)
 *     → manual-pin effect calls actions.setSelfPosition({...y})
 *     → SceneFrame's auto-warp (gravity off, threshold=0) pins the body
 *
 * If any link breaks (manual mode not entered, hook not published,
 * useEffect deps wrong, auto-warp regressed), the test fails fast with
 * the actual / expected Y values logged.
 */
import { test, expect } from '@playwright/test';
import { waitForCanvasReady } from './helpers.ts';

const SELF_ID = 'mugshot-player';

test('mugshot Y-offset slider moves the character body', async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto('/#mugshot/Barbarian', { waitUntil: 'domcontentloaded' });
  await waitForCanvasReady(page, 0, 30_000);
  await page.waitForFunction(
    () =>
      typeof (window as unknown as Record<string, unknown>)
        .__OFFICE_MUGSHOT_SET_Y_OFFSET__ === 'function',
    null,
    { timeout: 15_000 },
  );
  // Gravity drops the body from SPAWN_DROP_HEIGHT and it settles onto
  // the cubes; give it a beat to fall + ground before reading.
  await page.waitForTimeout(1000);

  const readY = async () =>
    page.evaluate((selfId: string) => {
      const s = (
        window as unknown as {
          __OFFICE_STORE__: {
            getState: () => {
              players: Record<string, { pos: { y: number } } | undefined>;
            };
          };
        }
      ).__OFFICE_STORE__.getState();
      return s.players[selfId]?.pos.y ?? null;
    }, SELF_ID);

  const setY = async (y: number) => {
    await page.evaluate((target: number) => {
      const fn = (
        window as unknown as {
          __OFFICE_MUGSHOT_SET_Y_OFFSET__: (y: number) => void;
        }
      ).__OFFICE_MUGSHOT_SET_Y_OFFSET__;
      fn(target);
    }, y);
    // React state → useEffect → setSelfPosition → SceneFrame
    // auto-warp → store reflects new pos. 400 ms is plenty even on
    // a cold cache.
    await page.waitForTimeout(400);
  };

  // Default settle (gravity, no override). Cube tops at y=1, near-zero
  // global controller skin → body root settles feet-flush at ≈0.50.
  const initial = await readY();
  expect(initial, 'pos.y not exposed').not.toBeNull();
  expect(Math.abs((initial as number) - 0.5)).toBeLessThan(0.05);

  // Lift the character into manual mode. Setting Y suspends gravity and
  // pins the body (auto-warp threshold=0), so even small deltas propagate.
  await setY(2.5);
  const lifted = await readY();
  expect(
    Math.abs((lifted as number) - 2.5),
    `expected pos.y near 2.5 after lift, got ${lifted}`,
  ).toBeLessThan(0.05);

  // Lower it back to a different non-default value.
  await setY(1.25);
  const lowered = await readY();
  expect(
    Math.abs((lowered as number) - 1.25),
    `expected pos.y near 1.25 after lower, got ${lowered}`,
  ).toBeLessThan(0.05);
});
