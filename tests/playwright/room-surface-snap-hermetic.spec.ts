/**
 * Sub-grid surface snapping, end to end in a real browser (hermetic
 * `?test=1`, no backend):
 *
 *   - A room whose block sits at a sub-grid height (y = 0.3 voxel, i.e.
 *     resting on a 0.15 m floor tile) loads and renders.
 *   - The Add tool, hovering that block's TOP, places the new block on the
 *     block's exact top (0.3 + 4 = 4.3 voxels), not on a whole-voxel row.
 *   - The inspector shows and edits sub-grid positions.
 *
 * Uses the `__primitive_blue` magic kind for the seeded block (no GLTF
 * fetch) and the catalog's "Blue block" (2 m) for the placement.
 */

import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { goToModeHermetic, waitForCanvasReady } from './helpers.ts';

const SEED = {
  rooms: [
    {
      name: 'default-v2',
      doc: {
        schemaVersion: 5,
        name: 'default-v2',
        title: 'default-v2',
        updatedAt: 0,
        commands: [
          { id: 'c1', op: 'placeObject', kindId: '__primitive_blue', position: [-2, 0.3, -2] },
        ],
        groups: {},
      },
    },
  ],
};

const axis = (page: Page, a: 'X' | 'Y' | 'Z') => page.getByRole('button', { name: `position ${a}` });

test('a block on a sub-grid surface loads, and Add stacks on its exact top', async ({ page }) => {
  await goToModeHermetic(page, 'room', SEED);
  const canvas = await waitForCanvasReady(page, 1200);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');

  // The seeded block renders (blue pixels on the canvas).
  const top = blueTop(await canvas.screenshot());

  // Select it: the inspector shows its sub-grid Y.
  await expect(async () => {
    await page.mouse.move(box.x + top.x, box.y + top.cy);
    await page.mouse.down();
    await page.mouse.up();
    await expect(axis(page, 'Y')).toBeVisible({ timeout: 500 });
  }).toPass();
  await expect(axis(page, 'Y')).toHaveText('0.300');

  // Stage the 2 m Blue block and click just inside the seeded block's top
  // silhouette edge, where the camera (looking down) sees its top face.
  await page.check('#room-show-layout-objects');
  await page.click('button[title="Blue block"]');
  await expect(async () => {
    await page.mouse.move(box.x + top.x, box.y + top.y + 6);
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.getByRole('combobox', { name: 'kind' })).toHaveText('colored_block_blue', {
      timeout: 500,
    });
  }).toPass();
  // The new block rests on the seeded block's exact top: 0.3 + 4 voxels.
  await expect(axis(page, 'Y')).toHaveText('4.300');
});

test('the inspector edits a position onto the sub-grid', async ({ page }) => {
  await goToModeHermetic(page, 'room', SEED);
  const canvas = await waitForCanvasReady(page, 1200);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const top = blueTop(await canvas.screenshot());
  await expect(async () => {
    await page.mouse.move(box.x + top.x, box.y + top.cy);
    await page.mouse.down();
    await page.mouse.up();
    await expect(axis(page, 'Y')).toBeVisible({ timeout: 500 });
  }).toPass();

  await axis(page, 'Y').click();
  const input = page.getByRole('textbox', { name: 'position Y' });
  // 0.4501 is quantized to the 1 mm (0.002-voxel) sub-grid on commit.
  await input.fill('0.4501');
  await input.press('Enter');
  await expect(axis(page, 'Y')).toHaveText('0.450');
});

/** Height of the editor HUD + toolbar strip drawn over the canvas top. */
const HUD_STRIP_PX = 60;

/** The topmost row of distinctly blue pixels (`y`) and its mean `x`, plus
 * the silhouette's middle row (`cy`), in canvas pixels. */
function blueTop(png: Buffer): { x: number; y: number; cy: number } {
  const { data, width } = PNG.sync.read(png);
  let minY = Infinity;
  const xsByRow = new Map<number, number[]>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 2] > 100 && data[i + 2] > data[i] + 30 && data[i + 2] > data[i + 1]) {
      const x = (i / 4) % width;
      const y = Math.floor(i / 4 / width);
      // Skip the HUD strip over the canvas (the highlighted blue tool button).
      if (y < HUD_STRIP_PX) continue;
      if (y < minY) minY = y;
      const row = xsByRow.get(y) ?? [];
      row.push(x);
      xsByRow.set(y, row);
    }
  }
  if (minY === Infinity) throw new Error('no blue block on the canvas');
  // Average a few rows below the very top edge for a stable x.
  const xs = [0, 1, 2, 3, 4].flatMap((d) => xsByRow.get(minY + d) ?? []);
  const ys = [...xsByRow.keys()];
  const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
  return { x: xs.reduce((a, b) => a + b, 0) / xs.length, y: minY, cy };
}
