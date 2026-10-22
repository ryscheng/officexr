/**
 * Debug mode in hermetic mode (`?test=1`): the world constants come from
 * the seeded in-memory storage, show in the tuning panels, drive the
 * scene, and a panel edit is saved back exactly once.
 */

import { expect, test, type Page } from '@playwright/test';
import { goToModeHermetic, waitForCanvasReady } from './helpers.ts';
import { DEFAULT_WORLD_CONSTANTS, type WorldConstants } from '../../packages/sdk/src/index.ts';

const RED = '#ff0000';

const SEEDED: WorldConstants = {
  ...DEFAULT_WORLD_CONSTANTS,
  animation: { ...DEFAULT_WORLD_CONSTANTS.animation, walkSpeed: 4.25 },
  background: { topColor: RED, bottomColor: RED },
};

type TestWindow = {
  __OFFICE_STORE__?: { getState: () => { worldConstants: WorldConstants } };
  __OFFICEXR_TEST_API__?: { worldConstantsSaves: WorldConstants[] };
};

const storeConstants = (page: Page) =>
  page.evaluate(() => (window as unknown as TestWindow).__OFFICE_STORE__?.getState().worldConstants);

const savedDocs = (page: Page) =>
  page.evaluate(() => (window as unknown as TestWindow).__OFFICEXR_TEST_API__?.worldConstantsSaves ?? []);

/** Fraction of sampled canvas pixels that are (near) pure red. */
async function redFraction(page: Page): Promise<number> {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) {
    return 0;
  }
  const png = await page.screenshot({ clip: box });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let red = 0;
    let total = 0;
    for (let i = 0; i < data.length; i += 4 * 97) {
      total++;
      if (data[i]! > 200 && data[i + 1]! < 40 && data[i + 2]! < 40) {
        red++;
      }
    }
    return red / total;
  }, png.toString('base64'));
}

test('seeded world constants show in the panels, drive the scene and save once per edit', async ({
  page,
}) => {
  test.setTimeout(90_000);

  await goToModeHermetic(page, 'debug', { worldConstants: SEEDED });
  await waitForCanvasReady(page, 3000, 30_000);

  await expect.poll(async () => (await storeConstants(page))?.animation.walkSpeed).toBe(4.25);
  await expect.poll(() => redFraction(page), { timeout: 15_000 }).toBeGreaterThan(0.05);

  await page.getByRole('button', { name: 'Animation' }).click();
  const walkSpeed = page.locator('label', { hasText: 'walk anim ×' }).locator('..').getByRole('button');
  await expect(walkSpeed).toHaveText('4.25');
  expect(await savedDocs(page)).toHaveLength(0);

  await walkSpeed.click();
  const input = page.locator('label', { hasText: 'walk anim ×' }).locator('..').locator('input');
  await input.fill('5');
  await input.press('Enter');

  await expect.poll(async () => (await storeConstants(page))?.animation.walkSpeed).toBe(5);
  await expect(page.getByTestId('world-constants-status')).toHaveText('Saved');
  // Past another debounce window, so a second save would have landed.
  await page.waitForTimeout(1000);
  const saves = await savedDocs(page);
  expect(saves).toHaveLength(1);
  expect(saves[0]!.animation.walkSpeed).toBe(5);
  expect(saves[0]!.background.topColor).toBe(RED);
});
