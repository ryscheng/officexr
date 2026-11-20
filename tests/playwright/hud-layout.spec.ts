/**
 * Hermetic HUD layout check: every scenario of `/hud-preview` on a phone, a tablet and a desktop viewport must
 * have no overlapping HUD controls, nothing outside the viewport and the device's safe area, and touch targets
 * of at least 44 px. It compares bounding boxes, not pixels, so it needs no baselines.
 */
import { expect, test } from '@playwright/test';
import {
  applySafeArea,
  collectHudBoxes,
  findOutside,
  findOverlaps,
  HUD_DEVICES,
  HUD_SCENARIOS,
  openHudPreview,
  runScenarioSteps,
} from './lib/hudLayout.ts';

test.describe.configure({ timeout: 180_000, mode: 'parallel' });

const MIN_TARGET_PX = 44;
const LAYOUT_DEVICES = HUD_DEVICES.filter((d) => ['iphone13-landscape', 'pixel5-landscape', 'ipad-landscape', 'desktop'].includes(d.id));

for (const device of LAYOUT_DEVICES) {
  for (const scenario of HUD_SCENARIOS) {
    test(`${scenario} on ${device.id}`, async ({ browser }) => {
      const { page, close } = await openHudPreview(browser, device, scenario, 'light');
      try {
        await runScenarioSteps(page, scenario);
        await applySafeArea(page, device.safe);
        const boxes = await collectHudBoxes(page);
        expect(boxes.length, 'the HUD rendered controls').toBeGreaterThan(5);
        const viewport = page.viewportSize()!;

        expect(findOverlaps(boxes).map(([a, b]) => `${a.name} / ${b.name}`), 'overlapping controls').toEqual([]);
        expect(findOutside(boxes, viewport, device.safe).map((b) => b.name), 'controls outside the safe area').toEqual([]);
        if (device.options?.hasTouch) {
          const small = boxes.filter((b) => b.interactive && (b.w < MIN_TARGET_PX - 0.5 || b.h < MIN_TARGET_PX - 0.5) && b.name !== 'input');
          expect(small.map((b) => `${b.name} ${Math.round(b.w)}x${Math.round(b.h)}`), 'touch targets under 44 px').toEqual([]);
        }
      } finally {
        await close();
      }
    });
  }
}
