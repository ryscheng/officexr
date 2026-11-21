/** Map toggle (button, M, Escape) and tap-to-go on `/hud-preview`, which joins the real scene to an in-memory office. */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { applySafeArea, HUD_DEVICES, openHudPreview } from './lib/hudLayout.ts';

test.describe.configure({ timeout: 180_000 });

const SHOT_DIR = process.env.MAP_SHOTS_DIR;
const DEVICES = HUD_DEVICES.filter((d) => ['desktop', 'iphone13-portrait', 'iphone13-landscape'].includes(d.id));

type Hook = { selfPos: () => { x: number; z: number } | null };
const selfPos = (page: Page) => page.evaluate(() => (window as unknown as { __hudPreview: Hook }).__hudPreview.selfPos());

const mapButton = (page: Page) => page.getByRole('button', { name: 'Map', exact: true });
const mapDialog = (page: Page) => page.getByRole('dialog', { name: 'Office map' });

async function mapButtonIsOnTop(page: Page) {
  return mapButton(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return hit !== null && el.contains(hit);
  });
}

async function tappedPoint(page: Page, fx: number, fy: number) {
  const svg = page.getByRole('img', { name: 'Map of the office' });
  const box = (await svg.boundingBox())!;
  const view = (await svg.getAttribute('viewBox'))!.split(' ').map(Number) as [number, number, number, number];
  const scale = Math.min(box.width / view[2], box.height / view[3]);
  const width = view[2] * scale;
  const height = view[3] * scale;
  const px = box.x + (box.width - width) / 2 + width * fx;
  const py = box.y + (box.height - height) / 2 + height * fy;
  const point = { x: view[0] + view[2] * fx, z: view[1] + view[3] * fy };
  await page.mouse.click(px, py);
  return point;
}

async function shot(page: Page, name: string) {
  if (SHOT_DIR) {
    mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
  }
}

for (const device of DEVICES) {
  test.describe(device.id, () => {
    test('toggles with the button, M and Escape, and the button stays on top', async ({ browser }) => {
      const { page, close } = await openHudPreview(browser, device, 'crowd', 'light');
      try {
        await applySafeArea(page, device.safe);
        await expect(mapButton(page)).toHaveAttribute('aria-pressed', 'false');
        await mapButton(page).click();
        await expect(mapDialog(page)).toBeVisible();
        await expect(mapButton(page)).toHaveAttribute('aria-pressed', 'true');
        expect(await mapButtonIsOnTop(page), 'the map overlay does not cover the Map button').toBe(true);
        await expect(mapDialog(page).getByRole('button', { name: /close/i })).toHaveCount(0);
        const dialog = (await mapDialog(page).boundingBox())!;
        const button = (await mapButton(page).boundingBox())!;
        expect(dialog.y, 'the map panel starts below the Map button').toBeGreaterThanOrEqual(button.y + button.height);
        await shot(page, `${device.id}-open`);

        await mapButton(page).click();
        await expect(mapDialog(page)).toHaveCount(0);
        await page.keyboard.press('m');
        await expect(mapDialog(page)).toBeVisible();
        await page.keyboard.press('m');
        await expect(mapDialog(page)).toHaveCount(0);
        await page.keyboard.press('m');
        await page.keyboard.press('Escape');
        await expect(mapDialog(page)).toHaveCount(0);
      } finally {
        await close();
      }
    });

    test('a tap walks the avatar toward the point', async ({ browser }) => {
      const { page, close } = await openHudPreview(browser, device, 'crowd', 'light');
      try {
        await applySafeArea(page, device.safe);
        const start = (await selfPos(page))!;
        await mapButton(page).click();
        const goal = await tappedPoint(page, 0.8, 0.3);
        const phone = device.id.startsWith('iphone');
        if (phone) {
          await expect(mapDialog(page)).toHaveCount(0);
          await mapButton(page).click();
        } else {
          await expect(mapDialog(page)).toBeVisible();
        }
        await shot(page, `${device.id}-walking`);
        await expect
          .poll(async () => {
            const now = (await selfPos(page))!;
            return Math.hypot(goal.x - now.x, goal.z - now.z);
          }, { timeout: 15_000 })
          .toBeLessThan(3.5);
        const now = (await selfPos(page))!;
        expect(Math.hypot(now.x - start.x, now.z - start.z), 'the avatar moved').toBeGreaterThan(1);
      } finally {
        await close();
      }
    });
  });
}

test('a movement key cancels the walk and a new tap replaces it', async ({ browser }) => {
  const device = DEVICES.find((d) => d.id === 'desktop')!;
  const { page, close } = await openHudPreview(browser, device, 'crowd', 'light');
  try {
    await mapButton(page).click();
    await tappedPoint(page, 0.8, 0.3);
    await expect(page.getByRole('img', { name: 'Walking here' })).toBeVisible();
    await tappedPoint(page, 0.2, 0.7);

    await page.keyboard.down('w');
    try {
      await expect(page.getByRole('img', { name: 'Walking here' })).toHaveCount(0, { timeout: 30_000 });
    } finally {
      await page.keyboard.up('w');
    }
  } finally {
    await close();
  }
});
