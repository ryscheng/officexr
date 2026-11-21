import { expect, test } from '@playwright/test';
import { collectHudBoxes, findOverlaps, HUD_DEVICES, openHudPreview } from './lib/hudLayout.ts';

test.describe.configure({ timeout: 180_000 });

const landscape = HUD_DEVICES.find((d) => d.id === 'iphone13-landscape')!;
const sized = (width: number, height: number) => ({
  ...landscape,
  id: `${width}x${height}`,
  options: { ...landscape.options, viewport: { width, height } },
});

for (const device of [landscape, sized(844, 390), sized(667, 375)]) {
  for (const expand of [false, true]) {
    test(`phone missions card ${expand ? 'expanded' : 'folded'} at ${device.id} overlaps no control`, async ({ browser }) => {
      const { page, close } = await openHudPreview(browser, device, 'missions', 'light');
      try {
        if (expand) {
          await page.getByRole('button', { name: 'Expand missions' }).click();
          await page.waitForTimeout(400);
        }
        const boxes = await collectHudBoxes(page);
        expect(findOverlaps(boxes).map(([a, b]) => `${a.name} / ${b.name}`)).toEqual([]);
        const card = boxes.find((b) => /missions/i.test(b.name) || b.name === 'Mine');
        expect(card).toBeTruthy();
      } finally {
        await close();
      }
    });
  }
}

test('M does not open the map while focus is in the new mission form', async ({ browser }) => {
  const desktop = HUD_DEVICES.find((d) => d.id === 'desktop')!;
  const { page, close } = await openHudPreview(browser, desktop, 'missions', 'light');
  try {
    await page.getByRole('button', { name: /Add mission/ }).click();
    await page.getByRole('button', { name: /^More: place/ }).click();
    await page.getByRole('button', { name: 'Place', exact: true }).focus();
    await page.keyboard.press('m');
    await expect(page.getByRole('dialog', { name: 'Office map' })).toHaveCount(0);
    await page.getByLabel('Title').type('time to meet');
    await expect(page.getByLabel('Title')).toHaveValue('time to meet');
    await expect(page.getByRole('dialog', { name: 'Office map' })).toHaveCount(0);
  } finally {
    await close();
  }
});
