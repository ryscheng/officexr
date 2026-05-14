/**
 * Room editor regressions. Pins:
 *
 *   - Canvas mounts and renders SOMETHING (catches "broken Three.js
 *     scene" regressions).
 *   - Staging a kind in the palette switches the active tool to Add.
 *   - The Add ghost preview shows up under the cursor.
 *
 * Room camera + selection wireframe + Tile/Delete tools will get
 * their own specs as those features land.
 */

import { expect, test } from '@playwright/test';
import {
  captureConsole,
  distinctColorsInCanvas,
  goToMode,
  waitForCanvasReady,
} from './helpers.ts';

test('Room mounts a canvas and renders SOMETHING', async ({ page }) => {
  const getConsole = captureConsole(page);
  await goToMode(page, 'room');
  const canvas = await waitForCanvasReady(page, 1500);
  const colorCount = await distinctColorsInCanvas(canvas);
  expect(colorCount, 'Room canvas screenshot should have color variation').toBeGreaterThan(20);
  const errors = getConsole().filter(
    (l) => l.startsWith('[error]') || l.startsWith('[pageerror]'),
  );
  expect(errors, 'no console errors during Room boot').toEqual([]);
});

test('clicking a palette swatch activates the Add tool', async ({ page }) => {
  await goToMode(page, 'room');
  await waitForCanvasReady(page, 1000);

  // The Toolbar lives in a `role="toolbar"` aria-region. Find the Add
  // tool button by its accessible name (its title includes "place"
  // when staged + "Pick a cube" when not).
  const toolbar = page.locator('div[role="toolbar"]');
  const buttons = await toolbar.locator('button').all();
  // Before staging there are 2 buttons (Select, Add — Add is disabled).
  expect(buttons.length).toBeGreaterThanOrEqual(2);

  // Add button is the 2nd toolbar button; it should be disabled
  // before staging.
  await expect(buttons[1]).toBeDisabled();

  // Click a known palette entry. Palette buttons have title="Blue block" etc.
  await page.click('button[title="Blue block"]');

  // After staging: the Add button is enabled and active.
  await expect(buttons[1]).toBeEnabled({ timeout: 2000 });
  // The active button has background #3b82f6; the inactive ones are
  // transparent. Use the Select button's background as a baseline.
  const selectBg = await buttons[0].evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  const addBg = await buttons[1].evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  // Active button has a coloured background; inactive should differ.
  expect(addBg, 'Add button should be visibly active after staging').not.toBe(selectBg);
});

test('Add tool ghost preview appears while hovering over the canvas', async ({
  page,
}) => {
  await goToMode(page, 'room');
  const canvas = await waitForCanvasReady(page, 1200);

  // Baseline: cursor off-canvas, no ghost.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(250);
  const baseline = await distinctColorsInCanvas(canvas, { samples: 600 });

  // Stage a kind so the Add tool has a model to preview.
  await page.click('button[title="Blue block"]');
  await page.waitForTimeout(200);

  // Move the cursor over the canvas center.
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('canvas has no bounding box');
  const cx = canvasBox.x + canvasBox.width / 2;
  const cy = canvasBox.y + canvasBox.height / 2;
  // Multiple moves — R3F sometimes needs them to deliver pointermove
  // events to the floor mesh.
  await page.mouse.move(cx - 200, cy - 100);
  await page.waitForTimeout(120);
  await page.mouse.move(cx, cy);
  await page.waitForTimeout(120);
  await page.mouse.move(cx + 50, cy + 30);
  await page.waitForTimeout(450);

  const withGhost = await distinctColorsInCanvas(canvas, { samples: 600 });

  // The ghost cube adds blue-ish pixels in the center. We expect the
  // distinct-byte-triple count to increase by at least a small delta
  // — even compressed-PNG noise produces some sensitivity to a new
  // material in the frame.
  expect(
    withGhost,
    `ghost preview should add variation (baseline=${baseline}, with-ghost=${withGhost})`,
  ).toBeGreaterThan(baseline);
});
