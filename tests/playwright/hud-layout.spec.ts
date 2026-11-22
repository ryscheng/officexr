/**
 * Hermetic HUD layout check: every scenario of `/hud-preview` on a phone, a tablet and a desktop viewport must
 * have no overlapping HUD controls, nothing outside the viewport and the device's safe area, and touch targets
 * of at least 44 px. It compares bounding boxes, not pixels, so it needs no baselines.
 */
import { expect, test } from '@playwright/test';
import {
  applySafeArea,
  awaitHint,
  collectHudBoxes,
  findOutside,
  findOverlaps,
  dragStick,
  findInGestureStrip,
  findInMiddleThird,
  hudCoverage,
  findTightGaps,
  HUD_DEVICES,
  HUD_SCENARIOS,
  HUD_STATES,
  openHudPreview,
  runScenarioSteps,
} from './lib/hudLayout.ts';

test.describe.configure({ timeout: 180_000, mode: 'parallel' });

const MIN_TARGET_PX = 48;
const MIN_GAP_PX = 8;
const GESTURE_STRIP_PX = 16;
const MAX_CHIP_SHARE = 0.6;
const LAYOUT_DEVICES = HUD_DEVICES.filter((d) => ['iphone13-landscape', 'pixel5-landscape', 'ipad-landscape', 'desktop', 'iphone13-portrait', 'iphone-se-portrait', 'pixel5-portrait'].includes(d.id));

const PORTRAIT_ONLY = new Set(['missions-sheet', 'chat-sheet', 'chat-keyboard', 'mission-keyboard']);
const isPortrait = (id: string) => id.endsWith('-portrait');

for (const device of LAYOUT_DEVICES) {
  for (const scenario of [...HUD_SCENARIOS, ...Object.keys(HUD_STATES).filter((s) => (isPortrait(device.id) || !PORTRAIT_ONLY.has(s)) && (HUD_STATES[s]?.only?.includes(device.id) ?? true))]) {
    test(`${scenario} on ${device.id}`, async ({ browser }) => {
      const { page, close } = await openHudPreview(browser, device, scenario, 'light');
      try {
        await applySafeArea(page, device.safe);
        await runScenarioSteps(page, scenario);
        const hint = HUD_STATES[scenario]?.hint;
        const plate = hint ? await awaitHint(page, hint) : null;
        const boxes = await collectHudBoxes(page);
        expect(boxes.length, 'the HUD rendered controls').toBeGreaterThan(3);
        const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));

        const page_ = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          canvas: (() => {
            const r = document.querySelector('canvas')?.getBoundingClientRect();
            return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null;
          })(),
        }));
        expect(page_.scrollWidth, 'horizontal scroll').toBeLessThanOrEqual(page_.innerWidth);
        expect(page_.canvas, 'the 3D canvas fills the viewport').toEqual({ w: viewport.width, h: viewport.height });

        expect(findOverlaps(boxes).map(([a, b]) => `${a.name} / ${b.name}`), 'overlapping controls').toEqual([]);
        expect(findOutside(boxes, viewport, device.safe).map((b) => b.name), 'controls outside the safe area').toEqual([]);
        if (plate) {
          expect(plate.width, 'hint width').toBeLessThanOrEqual(240.5);
          expect(plate.count, 'hints at once').toBe(1);
        }
        if (device.options?.hasTouch) {
          const small = boxes.filter((b) => b.interactive && !b.clipped && (b.w < MIN_TARGET_PX - 0.5 || b.h < MIN_TARGET_PX - 0.5) && b.name !== 'input');
          expect(small.map((b) => `${b.name} ${Math.round(b.w)}x${Math.round(b.h)}`), `touch targets under ${MIN_TARGET_PX} px`).toEqual([]);
        }
        if (isPortrait(device.id)) {
          const label = ([a, b]: [{ name: string }, { name: string }]) => `${a.name} / ${b.name}`;
          expect(findTightGaps(boxes, MIN_GAP_PX).map(label), `targets less than ${MIN_GAP_PX} px apart`).toEqual([]);
          if (scenario !== 'chat-keyboard' && scenario !== 'mission-keyboard') {
            expect(findInGestureStrip(boxes, viewport, GESTURE_STRIP_PX).map((b) => b.name), 'controls in the bottom gesture strip').toEqual([]);
          }
          const chip = boxes.find((b) => b.name === 'Expand missions');
          if (chip) {
            expect(chip.w, 'missions chip width').toBeLessThanOrEqual(viewport.width * MAX_CHIP_SHARE + 0.5);
            expect(chip.y, 'missions chip sits in the top third').toBeLessThan(viewport.height / 3);
            expect(Math.abs(chip.x + chip.w / 2 - viewport.width / 2), 'missions chip is centred').toBeLessThanOrEqual(8);
          }
          const sheets = await page.locator('[role="dialog"][data-hud-modal]').count();
          expect(sheets, 'sheets open at once').toBeLessThanOrEqual(1);
        }
      } finally {
        await close();
      }
    });
  }
}

test.describe('portrait phone', () => {
  const phones = HUD_DEVICES.filter((d) => ['iphone13-portrait', 'iphone-se-portrait'].includes(d.id));

  for (const device of phones) {
    test(`opens one sheet at a time and leaves the joystick reachable on ${device.id}`, async ({ browser }) => {
      const { page, close } = await openHudPreview(browser, device, 'crowd', 'light');
      try {
        const dialogs = page.locator('[role="dialog"][data-hud-modal]');
        await page.getByRole('button', { name: 'Expand missions' }).click();
        await expect(page.getByRole('dialog', { name: 'Missions' })).toBeVisible();

        await page.getByRole('button', { name: 'Office menu' }).click();
        await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible();
        await expect(dialogs).toHaveCount(1);

        await page.getByRole('button', { name: 'Close menu' }).click();
        await page.getByRole('button', { name: /^Chat/ }).click();
        await expect(page.getByRole('dialog', { name: 'Chat' })).toBeVisible();
        await expect(dialogs).toHaveCount(1);
        await page.getByRole('button', { name: 'Office menu' }).click();
        await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible();
        await expect(dialogs).toHaveCount(1);
        await page.getByRole('button', { name: 'Close menu' }).click();
        await page.getByRole('button', { name: /^Chat/ }).click();

        await page.getByRole('button', { name: 'Collapse chat' }).click();
        await expect(dialogs).toHaveCount(0);

        const hit = await page.evaluate(() => {
          const el = document.querySelector('[data-hud-item="Joystick"]')!;
          const r = el.getBoundingClientRect();
          return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.tagName;
        });
        expect(hit, 'the world, not a HUD panel, is under the joystick hint').toBe('CANVAS');
      } finally {
        await close();
      }
    });

    test(`missions sheet rows fit ${device.id}`, async ({ browser }) => {
      const { page, close } = await openHudPreview(browser, device, 'missions-sheet', 'light');
      try {
        await runScenarioSteps(page, 'missions-sheet');
        const viewport = page.viewportSize()!;
        const sheet = await page.getByRole('dialog', { name: 'Missions' }).boundingBox();
        expect(sheet!.x).toBeGreaterThanOrEqual(0);
        expect(sheet!.x + sheet!.width).toBeLessThanOrEqual(viewport.width);
        expect(sheet!.y, 'the top bar stays visible above the sheet').toBeGreaterThanOrEqual(64);
        for (const go of await page.getByRole('button', { name: /^Go to / }).all()) {
          const box = (await go.boundingBox())!;
          expect(box.x + box.width, 'Go button inside the sheet').toBeLessThanOrEqual(sheet!.x + sheet!.width);
          expect(box.width).toBeGreaterThanOrEqual(MIN_TARGET_PX);
        }
        const titles = await page.locator('[aria-label="My missions"] .line-clamp-2').evaluateAll((els) =>
          els.map((e) => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight))),
        );
        expect(Math.max(...titles), 'title lines').toBeLessThanOrEqual(2);
      } finally {
        await close();
      }
    });

    test(`chat sheet stays above a keyboard on ${device.id}`, async ({ browser }) => {
      const { page, close } = await openHudPreview(browser, device, 'chat-keyboard', 'light');
      try {
        await runScenarioSteps(page, 'chat-keyboard');
        const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
        const sheet = (await page.getByRole('dialog', { name: 'Chat' }).boundingBox())!;
        const input = (await page.getByPlaceholder('Message').boundingBox())!;
        expect(sheet.y + sheet.height, 'sheet bottom').toBeLessThanOrEqual(viewport.height);
        expect(input.y + input.height, 'input above the bottom edge').toBeLessThanOrEqual(viewport.height);
        expect(sheet.y, 'sheet below the top bar').toBeGreaterThanOrEqual(64);
        expect(input.height).toBeGreaterThanOrEqual(MIN_TARGET_PX);
        await page.getByPlaceholder('Message').fill('sent from the sheet');
        await page.getByRole('button', { name: 'Send' }).click();
        await expect(page.getByPlaceholder('Message')).toBeVisible();
        await expect(page.getByText('sent from the sheet')).toBeVisible();
      } finally {
        await close();
      }
    });

    test(`chat preview shows for a new message and is gone after folding on ${device.id}`, async ({ browser }) => {
      const { page, close } = await openHudPreview(browser, device, 'chat-rest', 'light');
      try {
        await page.getByRole('button', { name: /^Chat/ }).click();
        await page.getByRole('button', { name: 'Collapse chat' }).click();
        await runScenarioSteps(page, 'chat-peek');
        await expect(page.getByRole('button', { name: /New message from/ })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Chat, 1 new' })).toBeVisible();
        await page.getByRole('button', { name: /^Chat/ }).click();
        await page.keyboard.press('Escape');
        await runScenarioSteps(page, 'chat-peek');
        const preview = page.getByRole('button', { name: /New message from/ });
        const top = await page.evaluate(() => document.querySelector('[aria-label^="New message from"]')?.getBoundingClientRect().y);
        const viewport = page.viewportSize()!;
        expect(top, 'preview stays out of the middle of the view').toBeGreaterThan(viewport.height / 2);
        await page.waitForTimeout(6000);
        await expect(preview).toHaveCount(0);
      } finally {
        await close();
      }
    });

    test(`the missions chip collapses while moving and returns after on ${device.id}`, async ({ browser }) => {
      const { page, close } = await openHudPreview(browser, device, 'crowd', 'light');
      try {
        const chip = page.getByRole('button', { name: 'Expand missions' });
        const resting = (await chip.boundingBox())!;
        const lift = await dragStick(page, 2300);
        const collapsed = (await chip.boundingBox())!;
        expect(collapsed.width, 'collapsed chip is narrower').toBeLessThan(resting.width);
        await lift();
        await page.waitForTimeout(1200);
        expect((await chip.boundingBox())!.width).toBeCloseTo(resting.width, 0);
      } finally {
        await close();
      }
    });

    test(`the joystick is fixed in Free look, and floats under the thumb in Angled on ${device.id}`, async ({ browser }) => {
      for (const view of ['free-look', 'angled']) {
        const { page, close } = await openHudPreview(browser, device, 'crowd', 'light');
        try {
          await page.evaluate((v) => localStorage.setItem('officexr:gameView', v), view);
          await page.reload();
          await page.getByRole('button', { name: 'Office menu' }).first().waitFor();
          await page.waitForTimeout(1500);
          const stick = page.locator('[data-hud-item="Joystick"]');
          const rest = (await stick.boundingBox())!;
          await dragStick(page, 300);
          const held = (await stick.boundingBox())!;
          const { width, height } = page.viewportSize()!;
          if (view === 'angled') {
            expect(held.x + held.width / 2, 'stick centred under the thumb').toBeCloseTo(Math.round(width * 0.25), -1);
            expect(held.y + held.height / 2).toBeCloseTo(Math.round(height * 0.78), -1);
          } else {
            expect(held.x).toBeCloseTo(rest.x, 0);
            expect(held.y).toBeCloseTo(rest.y, 0);
          }
        } finally {
          await close();
        }
      }
    });
  }
});

const MAX_COVERAGE = 0.2;

test.describe('HUD coverage at rest', () => {
  const cases = [
    { name: 'portrait 390x844', device: 'iphone13-portrait', viewport: { width: 390, height: 844 }, middleClear: true },
    { name: 'landscape 844x390', device: 'iphone13-landscape', viewport: { width: 844, height: 390 }, middleClear: false },
  ];
  for (const c of cases) {
    test(`covers at most ${MAX_COVERAGE * 100}% of the screen on ${c.name}`, async ({ browser }) => {
      const base = HUD_DEVICES.find((d) => d.id === c.device)!;
      const device = { ...base, options: { ...base.options, viewport: c.viewport } };
      const { page, close } = await openHudPreview(browser, device, 'rest', 'light');
      try {
        await applySafeArea(page, device.safe);
        const boxes = await collectHudBoxes(page);
        const coverage = hudCoverage(boxes, c.viewport);
        console.log(`HUD coverage at rest, ${c.name}: ${(coverage * 100).toFixed(1)}%`);
        expect(coverage, 'share of the screen covered by HUD boxes').toBeLessThanOrEqual(MAX_COVERAGE);
        if (c.middleClear) {
          expect(findInMiddleThird(boxes, c.viewport).map((b) => b.name), 'HUD in the middle third at rest').toEqual([]);
        }
      } finally {
        await close();
      }
    });
  }
});

test.describe('first-run hints', () => {
  const cases = [
    { name: 'portrait 390x844', device: 'iphone13-portrait', viewport: { width: 390, height: 844 }, hints: ['hint-move', 'hint-people'] },
    { name: 'landscape 844x390', device: 'iphone13-landscape', viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 }, hints: ['hint-move', 'hint-people'] },
    { name: 'desktop 1280x800', device: 'desktop', viewport: { width: 1280, height: 800 }, hints: ['hint-move', 'hint-people'] },
    { name: 'small phone 320x568', device: 'iphone-se-portrait', viewport: { width: 320, height: 568 }, hints: ['hint-move', 'hint-people'] },
  ];
  for (const c of cases) {
    for (const state of c.hints) {
      test(`${state} stays out of the middle third and off the controls on ${c.name}`, async ({ browser }) => {
        const base = HUD_DEVICES.find((d) => d.id === c.device)!;
        const device = { ...base, options: { ...base.options, viewport: c.viewport, ...(c.screen ? { screen: c.screen } : {}) } };
        const { page, close } = await openHudPreview(browser, device, state, 'light');
        try {
          await applySafeArea(page, device.safe);
          await runScenarioSteps(page, state);
          const hint = HUD_STATES[state]!.hint!;
          const plate = await awaitHint(page, hint);
          const boxes = await collectHudBoxes(page);
          const inX = plate.x < (c.viewport.width * 2) / 3 && plate.x + plate.width > c.viewport.width / 3;
          const inY = plate.y < (c.viewport.height * 2) / 3 && plate.y + plate.height > c.viewport.height / 3;
          expect(inX && inY, 'the hint sits in the middle third').toBe(false);
          expect(findOverlaps(boxes).map(([a, b]) => `${a.name} / ${b.name}`), 'overlapping controls').toEqual([]);
          expect(findOutside(boxes, c.viewport, device.safe).map((b) => b.name), 'controls outside the safe area').toEqual([]);
        } finally {
          await close();
        }
      });
    }
  }

  test('the build hint sits inside the menu sheet next to the Build row on desktop', async ({ browser }) => {
    const device = HUD_DEVICES.find((d) => d.id === 'desktop')!;
    const { page, close } = await openHudPreview(browser, device, 'hint-build', 'light');
    try {
      await runScenarioSteps(page, 'hint-build');
      const plate = await awaitHint(page, 'build');
      const row = await page.getByRole('button', { name: /^Build/ }).boundingBox();
      const sheet = await page.getByRole('dialog', { name: 'Menu' }).boundingBox();
      expect(plate.x, 'inside the sheet').toBeGreaterThanOrEqual(sheet!.x);
      expect(plate.y, 'under the Build row').toBeGreaterThanOrEqual(row!.y + row!.height);
      expect(plate.y - (row!.y + row!.height), 'close to the Build row').toBeLessThanOrEqual(16);
    } finally {
      await close();
    }
  });

  test('a hint disappears when the person does the action and stays gone after a reload', async ({ browser }) => {
    const device = HUD_DEVICES.find((d) => d.id === 'desktop')!;
    const { page, close } = await openHudPreview(browser, device, 'hint-people', 'light');
    try {
      await runScenarioSteps(page, 'hint-people');
      await awaitHint(page, 'people');
      await page.getByRole('button', { name: /^People here/ }).click();
      await expect(page.locator('[data-hint]')).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem('officexr:hint:people'))).toBe('done');
    } finally {
      await close();
    }
  });
});
