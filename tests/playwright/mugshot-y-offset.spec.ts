/**
 * Regression for the Mugshot Y-offset slider. The slider is the
 * primary live diagnostic for "is my character placed correctly on
 * the cube?" — if its plumbing breaks, the human loses the ability
 * to surface placement bugs interactively.
 *
 * Asserts that pushing a new Y through
 * `__OFFICE_MUGSHOT_SET_Y_OFFSET__` reaches `store.players[selfId]
 * .pos.y` within a few frames. The state path is:
 *   setYOffset(y)
 *     → useEffect that calls actions.setSelfPosition({...y})
 *     → SceneFrame's auto-warp (with gravity off, threshold=0)
 *       teleports the body
 *     → next setSelfPosition reflects the new pos
 *
 * If any link in that chain breaks (gravity not disabled, hook not
 * published, useEffect deps wrong, auto-warp logic regressed), the
 * test fails fast with the actual / expected Y values logged.
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
  // Gravity-disable runs once the stack settles + Scene mounts; the
  // initial setSelfPosition at the default Y also needs a beat to
  // flush through SceneFrame's auto-warp.
  await page.waitForTimeout(800);

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

  // Default settle.
  const initial = await readY();
  expect(initial, 'pos.y not exposed').not.toBeNull();
  expect(Math.abs((initial as number) - 1.51)).toBeLessThan(0.05);

  // Lift the character. Auto-warp threshold=0 (gravity off) means
  // even small deltas propagate.
  await setY(3.5);
  const lifted = await readY();
  expect(
    Math.abs((lifted as number) - 3.5),
    `expected pos.y near 3.5 after lift, got ${lifted}`,
  ).toBeLessThan(0.05);

  // Lower it back to a different non-default value.
  await setY(2.25);
  const lowered = await readY();
  expect(
    Math.abs((lowered as number) - 2.25),
    `expected pos.y near 2.25 after lower, got ${lowered}`,
  ).toBeLessThan(0.05);
});
