/**
 * Regression for the Mugshot export's Y-handling. Previously the
 * export snapped Y to the system default before capturing — but
 * that meant the captured PNGs didn't reflect the Y the human had
 * tuned in the live preview. The ideal-baseline workflow needs
 * captures that look like what the user sees, so the export now
 * captures AT the live Y.
 *
 * Decoupling from the test's assertion target: the MANIFEST still
 * omits yOffset (so the manifest-load path at test time forces Y
 * back to default). The pixels and the recipe live in different
 * places — pixels reflect the curated Y, the recipe doesn't carry
 * it. At test time the renderer produces images at default Y and
 * the diff against the curated PNGs surfaces any placement drift.
 *
 * This spec asserts the property the bug-fix introduced: setting Y
 * via the live hook and then triggering an export captures every
 * angle/mode AT that Y, not at any default. If the snap-to-default
 * regression ever returns, `capturedYs` would all be 1.51 and this
 * test fails with a clear "expected 3.0, got 1.51" message.
 */
import { test, expect } from '@playwright/test';
import { waitForCanvasReady } from './helpers.ts';

const SELF_ID = 'mugshot-player';

test('mugshot export captures at the tuned Y, not a snapped default', async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto('/#mugshot/Barbarian', { waitUntil: 'domcontentloaded' });
  await waitForCanvasReady(page, 0, 30_000);

  await page.waitForFunction(
    () =>
      typeof (window as unknown as Record<string, unknown>)
        .__OFFICE_MUGSHOT_SET_Y_OFFSET__ === 'function' &&
      typeof (window as unknown as Record<string, unknown>)
        .__OFFICE_MUGSHOT_TRIGGER_EXPORT__ === 'function',
    null,
    { timeout: 15_000 },
  );
  // Gravity-disable + initial settle.
  await page.waitForTimeout(800);

  // Tune Y to a clearly non-default value.
  const TUNED_Y = 3.0;
  await page.evaluate((y: number) => {
    (
      window as unknown as {
        __OFFICE_MUGSHOT_SET_Y_OFFSET__: (y: number) => void;
      }
    ).__OFFICE_MUGSHOT_SET_Y_OFFSET__(y);
  }, TUNED_Y);
  await page.waitForTimeout(400);

  // Sanity: SDK store reflects the tuned Y BEFORE the export runs.
  const beforeY = await page.evaluate((selfId: string) => {
    return (
      window as unknown as {
        __OFFICE_STORE__: {
          getState: () => {
            players: Record<string, { pos: { y: number } } | undefined>;
          };
        };
      }
    ).__OFFICE_STORE__.getState().players[selfId]?.pos.y;
  }, SELF_ID);
  expect(Math.abs((beforeY ?? 0) - TUNED_Y)).toBeLessThan(0.05);

  // Trigger the export without producing a file download.
  await page.evaluate(async () => {
    const fn = (
      window as unknown as {
        __OFFICE_MUGSHOT_TRIGGER_EXPORT__: (opts?: {
          download?: boolean;
        }) => Promise<void>;
      }
    ).__OFFICE_MUGSHOT_TRIGGER_EXPORT__;
    await fn({ download: false });
  });

  // Read the diagnostic side-channel the export writes after every
  // capture: an array of { mode, angle, y } for each of the 8
  // captures. If the snap-to-default regression returned, every Y
  // here would be ~1.51 instead of ~3.0.
  const debug = await page.evaluate(() => {
    return (
      window as unknown as {
        __OFFICE_MUGSHOT_LAST_EXPORT__?: {
          capturedYs: Array<{ mode: string; angle: number; y: number }>;
          blobSize: number;
          downloaded: boolean;
        };
      }
    ).__OFFICE_MUGSHOT_LAST_EXPORT__;
  });
  expect(debug, 'export did not publish __OFFICE_MUGSHOT_LAST_EXPORT__').not.toBeUndefined();
  expect(debug!.downloaded, 'opts.download:false should suppress the file download').toBe(false);
  expect(debug!.capturedYs.length, 'expected 8 captures (4 angles × 2 modes)').toBe(8);
  expect(debug!.blobSize, 'zip blob should be non-empty').toBeGreaterThan(0);

  for (const cap of debug!.capturedYs) {
    expect(
      Math.abs(cap.y - TUNED_Y),
      `capture (mode=${cap.mode}, angle=${cap.angle}) was at y=${cap.y}, expected ~${TUNED_Y}`,
    ).toBeLessThan(0.05);
  }

  // After export, the body should STILL be at the tuned Y — the
  // export must not silently restore default.
  const afterY = await page.evaluate((selfId: string) => {
    return (
      window as unknown as {
        __OFFICE_STORE__: {
          getState: () => {
            players: Record<string, { pos: { y: number } } | undefined>;
          };
        };
      }
    ).__OFFICE_STORE__.getState().players[selfId]?.pos.y;
  }, SELF_ID);
  expect(
    Math.abs((afterY ?? 0) - TUNED_Y),
    `pos.y should still be ~${TUNED_Y} after export, got ${afterY}`,
  ).toBeLessThan(0.05);
});
