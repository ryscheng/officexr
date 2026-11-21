import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { HUD_DEVICES, openHudPreview } from './lib/hudLayout.ts';

test.describe.configure({ timeout: 180_000, mode: 'parallel' });

const VIEW_KEY = 'officexr:gameView';
const DEVICES = HUD_DEVICES.filter((d) => ['iphone13-portrait', 'iphone13-landscape'].includes(d.id));

async function open(browser: Parameters<typeof openHudPreview>[0], device: (typeof DEVICES)[number], view: string) {
  const opened = await openHudPreview(browser, device, 'alone', 'light');
  await opened.page.evaluate(([key, v]) => localStorage.setItem(key, v), [VIEW_KEY, view] as const);
  await opened.page.reload();
  await opened.page.getByRole('button', { name: 'Office menu' }).first().waitFor();
  await opened.page.waitForTimeout(6000);
  return opened;
}

async function touchDrag(page: Page, from: { x: number; y: number }, by: { dx: number; dy: number }, holdMs: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let i = 1; i <= 6; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from.x + (by.dx * i) / 6, y: from.y + (by.dy * i) / 6 }],
    });
  }
  await page.waitForTimeout(holdMs);
  return async () => void (await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }));
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

const floorShift = async (page: Page, before: Buffer) => Math.abs(floorShare(await page.screenshot()) - floorShare(before));

const SHOT_DIR = process.env.P11_SHOT_DIR;
const shot = async (page: Page, name: string) => {
  if (SHOT_DIR) {
    await page.screenshot({ path: `${SHOT_DIR}/${name}.png` });
  }
};

const rightSide = (page: Page) => {
  const { width, height } = page.viewportSize()!;
  return { x: Math.round(width * 0.75), y: Math.round(height * 0.4) };
};

for (const device of DEVICES) {
  test.describe(device.id, () => {
    test('in Free look, a drag on the right turns the view and does not start the joystick', async ({ browser }) => {
      const { page, close } = await open(browser, device, 'free-look');
      try {
        const stick = page.locator('[data-hud-item="Joystick"]');
        const rest = (await stick.boundingBox())!;
        const before = await page.screenshot();
        const lift = await touchDrag(page, rightSide(page), { dx: 0, dy: 150 }, 0);
        const held = (await stick.boundingBox())!;
        await lift();
        await page.waitForTimeout(300);
        expect(await stick.getAttribute('data-joystick-floating')).toBeNull();
        expect(held).toEqual(rest);
        const shift = await floorShift(page, before);
        console.log(`${device.id} Free look, drag on the right: floor share moved by ${(shift * 100).toFixed(1)} points`);
        expect(shift, 'the view tilted').toBeGreaterThan(0.1);
      } finally {
        await close();
      }
    });

    test('in Free look, a touch on the fixed joystick moves the player', async ({ browser }) => {
      const { page, close } = await open(browser, device, 'free-look');
      try {
        const stick = page.locator('[data-hud-item="Joystick"]');
        const box = (await stick.boundingBox())!;
        const chip = page.getByRole('button', { name: 'Expand missions' });
        const resting = (await chip.boundingBox())!;
        const lift = await touchDrag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { dx: 40, dy: 0 }, 2300);
        expect((await chip.boundingBox())!.width, 'the missions chip folds while the player moves').toBeLessThan(resting.width);
        expect(await stick.boundingBox()).toEqual(box);
        await lift();
      } finally {
        await close();
      }
    });

    test('in Angled, a drag anywhere moves the player and keeps the view', async ({ browser }) => {
      const { page, close } = await open(browser, device, 'angled');
      try {
        const stick = page.locator('[data-hud-item="Joystick"]');
        expect(await stick.getAttribute('data-joystick-floating')).toBe('true');
        const from = rightSide(page);
        const chip = page.getByRole('button', { name: 'Expand missions' });
        const resting = (await chip.boundingBox())!;

        const before = await page.screenshot();
        await shot(page, `${device.id}-locked-before`);
        await (await touchDrag(page, from, { dx: 0, dy: 150 }, 0))();
        await page.waitForTimeout(300);
        await shot(page, `${device.id}-locked-after`);
        const shift = await floorShift(page, before);
        console.log(`${device.id} Angled, drag on the right: floor share moved by ${(shift * 100).toFixed(1)} points`);
        expect(shift, 'the view stayed').toBeLessThan(0.03);

        const lift = await touchDrag(page, from, { dx: 40, dy: 0 }, 2300);
        const held = (await stick.boundingBox())!;
        expect(held.x + held.width / 2, 'stick under the thumb').toBeCloseTo(from.x, -1);
        expect(held.y + held.height / 2).toBeCloseTo(from.y, -1);
        expect((await chip.boundingBox())!.width, 'the missions chip folds while the player moves').toBeLessThan(resting.width);
        await lift();
      } finally {
        await close();
      }
    });
  });
}
