import { expect, test, type Page } from '@playwright/test';
import { goToMode } from './helpers.ts';

type Store = { getState: () => { players: Record<string, { pos: { x: number; y: number; z: number } }> } };

const selfPos = (page: Page) =>
  page.evaluate(() => {
    const store = (window as unknown as { __OFFICE_STORE__?: Store }).__OFFICE_STORE__;
    return store?.getState().players['local-player']?.pos ?? null;
  });

async function waitUntilSettled(page: Page) {
  let last = await selfPos(page);
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(500);
    const pos = await selfPos(page);
    if (pos && last && Math.abs(pos.y - last.y) < 1e-3 && Math.hypot(pos.x - last.x, pos.z - last.z) < 1e-3) {
      return pos;
    }
    last = pos;
  }
  throw new Error('the player never settled');
}

test('top-down camera: arrow keys move up the screen and a floor click walks there', async ({ page }) => {
  test.setTimeout(90_000);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });

  await goToMode(page, 'debug');
  await expect(page.locator('canvas').first()).toBeVisible();
  const start = await waitUntilSettled(page);
  await shot('01-fixed.png');

  await page.keyboard.press('Alt+KeyP');
  await page.waitForTimeout(800);
  await shot('02-topdown.png');

  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(700);
  await page.keyboard.up('ArrowUp');
  const afterKeys = await waitUntilSettled(page);
  await shot('03-after-keys.png');
  expect(start.z - afterKeys.z, 'up arrow moves toward -z, up the screen').toBeGreaterThan(0.5);
  expect(Math.abs(afterKeys.x - start.x), 'no sideways drift').toBeLessThan(0.5);

  const box = (await page.locator('canvas').first().boundingBox())!;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.click(centre.x + 150, centre.y + 60);
  await expect
    .poll(async () => ((await selfPos(page))?.x ?? 0) - afterKeys.x, { timeout: 15_000 })
    .toBeGreaterThan(1);
  const afterClick = await waitUntilSettled(page);
  await shot('04-after-click.png');
  expect(afterClick.x - afterKeys.x, 'walked right toward the click').toBeGreaterThan(1);
  expect(afterClick.z - afterKeys.z, 'and down the screen toward it').toBeGreaterThan(0.2);
});
