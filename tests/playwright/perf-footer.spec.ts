/**
 * Perf footer — the global render-stats strip at the bottom of the
 * studio (`packages/studio/src/ui/PerfFooter.tsx`).
 *
 * Coverage:
 *   1. A mounted editor canvas publishes live samples — the footer
 *      shows real numbers (fps + draw calls), not the idle message.
 *   2. `?perfFooter=0` suppresses the footer entirely. This is the
 *      seam the motion-keyframe specs rely on to keep the Debug
 *      canvas viewport (and their screenshot baselines) stable —
 *      if it breaks, those suites fail with size mismatches.
 */

import { test, expect } from '@playwright/test';
import { goToModeHermetic, waitForCanvasReady } from './helpers.ts';

test('perf footer shows live fps + draw-call samples from the active canvas', async ({
  page,
}) => {
  await goToModeHermetic(page, 'map');
  await waitForCanvasReady(page);

  const footer = page.locator('footer', { hasText: 'fps' });
  await expect(footer).toBeVisible({ timeout: 10_000 });

  // The probe publishes a sample every ~500 ms; "fps" must be followed
  // by a real number once the first window closes.
  await expect(footer).toContainText(/fps\s*\d+/i, { timeout: 10_000 });
  await expect(footer).toContainText(/draws\s*[\d,]+/i);
  await expect(footer).toContainText(/tris\s*[\d,]+/i);
});

test('?perfFooter=0 suppresses the footer (screenshot-baseline seam)', async ({
  page,
}) => {
  await page.goto('/?test=1&perfFooter=0#map', {
    waitUntil: 'domcontentloaded',
  });
  await waitForCanvasReady(page);

  await expect(page.locator('footer')).toHaveCount(0);
});
