import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { HUD_DEVICES, openHudPreview } from './lib/hudLayout.ts';

test.describe.configure({ timeout: 420_000 });

const VIEW_KEY = 'officexr:gameView';
const DESKTOP = HUD_DEVICES.find((d) => d.id === 'desktop')!;

async function openFreeLook(browser: Parameters<typeof openHudPreview>[0]) {
  const opened = await openHudPreview(browser, DESKTOP, 'alone', 'light');
  await opened.page.evaluate(([key, v]) => localStorage.setItem(key, v), [VIEW_KEY, 'free-look'] as const);
  await opened.page.reload();
  await opened.page.getByRole('button', { name: 'Office menu' }).first().waitFor();
  await opened.page.waitForTimeout(6000);
  return opened;
}

function floorShare(png: Buffer): number {
  const { data, width, height } = PNG.sync.read(png);
  let floor = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 2]! > 60 && data[i + 2]! > data[i]! + 30) {
      floor++;
    }
  }
  return floor / (width * height);
}

const locked = (page: Page) => page.evaluate(() => document.pointerLockElement !== null);

const canvasPoint = (page: Page) => {
  const { width, height } = page.viewportSize()!;
  return { x: Math.round(width * 0.6), y: Math.round(height * 0.4) };
};

test('in Free look, a click does not lock the pointer', async ({ browser }) => {
  const { page, close } = await openFreeLook(browser);
  try {
    const at = canvasPoint(page);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    expect(await locked(page)).toBe(false);
    await page.mouse.up();
    expect(await locked(page)).toBe(false);
  } finally {
    await close();
  }
});

test('in Free look, a right drag turns the view and leaves the pointer unlocked', async ({ browser }) => {
  const { page, close } = await openFreeLook(browser);
  try {
    const at = canvasPoint(page);
    const before = floorShare(await page.screenshot());
    await page.mouse.move(at.x, at.y);
    await page.mouse.down({ button: 'right' });
    for (let i = 1; i <= 4; i++) {
      await page.mouse.move(at.x, at.y + i * 40);
    }
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(500);
    expect(await locked(page)).toBe(false);
    const shift = Math.abs(floorShare(await page.screenshot()) - before);
    console.log(`Free look, right drag: floor share moved by ${(shift * 100).toFixed(1)} points`);
    expect(shift, 'the view tilted').toBeGreaterThan(0.05);
  } finally {
    await close();
  }
});

test('in Free look, a left drag turns the view and a short press does not', async ({ browser }) => {
  const { page, close } = await openFreeLook(browser);
  try {
    const at = canvasPoint(page);
    const before = floorShare(await page.screenshot());
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x, at.y + 3);
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(Math.abs(floorShare(await page.screenshot()) - before), 'a short press stayed a click').toBeLessThan(0.01);

    await page.mouse.down();
    for (let i = 1; i <= 4; i++) {
      await page.mouse.move(at.x, at.y + i * 40);
    }
    await page.mouse.up();
    await page.waitForTimeout(500);
    expect(await locked(page)).toBe(false);
    expect(Math.abs(floorShare(await page.screenshot()) - before), 'the view tilted').toBeGreaterThan(0.05);
  } finally {
    await close();
  }
});
