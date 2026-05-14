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

test('Add tool ghost preview renders a blue ghost cube under the cursor', async ({
  page,
}) => {
  await goToMode(page, 'room');
  const canvas = await waitForCanvasReady(page, 1500);

  // Stage a kind so the Add tool has a model to preview.
  await page.click('button[title="Blue block"]');
  await page.waitForTimeout(300);

  // Move the cursor over the floor at a position where the ghost
  // should clearly land. The orbit camera looks down at the room
  // origin from a slight angle; below-center of the canvas is the
  // floor near the camera.
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('canvas has no bounding box');
  const cx = canvasBox.x + canvasBox.width / 2;
  const cy = canvasBox.y + canvasBox.height / 2 + 60;
  await page.mouse.move(cx - 200, cy - 100);
  await page.waitForTimeout(120);
  await page.mouse.move(cx, cy);
  await page.waitForTimeout(700);

  // Read pixels via WebGL near the cursor and look for a distinctly
  // blue signal. A pixel-variation byte-triple count proved too weak
  // — it was passing on rendering noise even when no ghost appeared
  // (caused by R3F failing to deliver pointermove to a FloorPicker
  // co-planar with EndlessGrid). The blue-pixel test catches that.
  const result = await page.evaluate(
    ({ cx, cy }) => {
      return new Promise<{ hasBluePixel: boolean }>((resolve) => {
        requestAnimationFrame(() => {
          const c = document.querySelector('canvas') as HTMLCanvasElement;
          const gl = c.getContext('webgl2') || c.getContext('webgl');
          if (!gl) return resolve({ hasBluePixel: false });
          const r = c.getBoundingClientRect();
          const dpr = window.devicePixelRatio || 1;
          const localX = (cx - r.left) * dpr;
          const localY = (cy - r.top) * dpr;
          const fbX = Math.round(localX);
          const fbY = c.height - Math.round(localY);
          const px = new Uint8Array(4);
          let hasBluePixel = false;
          for (let dy = -40; dy <= 40 && !hasBluePixel; dy += 8) {
            for (let dx = -40; dx <= 40 && !hasBluePixel; dx += 8) {
              gl.readPixels(
                Math.max(0, Math.min(c.width - 1, fbX + dx)),
                Math.max(0, Math.min(c.height - 1, fbY + dy)),
                1,
                1,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                px,
              );
              // KayKit blue block renders as a bright #3b82f6-ish blue.
              // "Distinctly blue" = B > 100 AND clearly bluer than R or G.
              if (px[2] > 100 && px[2] > px[0] + 30 && px[2] > px[1]) {
                hasBluePixel = true;
              }
            }
          }
          resolve({ hasBluePixel });
        });
      });
    },
    { cx, cy },
  );

  expect(
    result.hasBluePixel,
    'expected a distinctly-blue ghost pixel near the cursor',
  ).toBe(true);
});
