/**
 * Hermetic-mode regression spec. Boots the studio with `?test=1`, which
 * swaps the live `/api/*` backend for in-memory storages seeded via
 * `window.__OFFICEXR_TEST_SEED__`. Proves end-to-end that:
 *   - the hermetic catalog api mounts (no /api/world-object-kinds fetch),
 *   - the in-memory MapStorage loads the seeded `default` map,
 *   - the editor reflects the seeded room instances,
 *   - the canvas renders real geometry.
 *
 * This is the Tier 4 backstop for the c606f10 class: a real browser, a
 * real renderer, no backend.
 */

import { expect, test, type Locator, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import {
  goToModeHermetic,
  waitForCanvasReady,
  distinctColorsInCanvas,
} from './helpers.ts';

const ENVIRONMENT = {
  sun: {
    positionX: 20,
    positionY: 40,
    positionZ: 20,
    color: '#ffffff',
    intensity: 1.4,
  },
  sky: null,
  stars: null,
  hdri: null,
  ambientIntensity: 0.15,
};

const blueBlock = (id: string, position: number[]) => ({
  id,
  op: 'placeObject',
  kindId: '__primitive_blue',
  position,
});

// A map named `default` (the hook's default-open name) with two inline room
// instances and one baked-only one (empty commands + a layoutName, so its
// geometry comes from the layout). Blocks use the `__primitive_blue` magic
// kind so they render without a GLTF fetch. Plain JSON so it survives
// addInitScript.
const SEED = {
  maps: [
    {
      name: 'default',
      doc: {
        schemaVersion: 2,
        name: 'default',
        title: 'Default',
        updatedAt: 0,
        rooms: [
          { id: 'inst-a', roomName: 'snap-room', position: [0, 0, 0], rotationY: 0 },
          { id: 'inst-b', roomName: 'snap-room', position: [6, 0, 0], rotationY: 0 },
          { id: 'inst-c', roomName: 'baked-room', position: [0, 0, 8], rotationY: 0 },
        ],
        spawnPoints: [],
        environment: ENVIRONMENT,
      },
    },
    {
      name: 'other',
      doc: {
        schemaVersion: 2,
        name: 'other',
        title: 'Other',
        updatedAt: 0,
        rooms: [],
        spawnPoints: [],
        environment: ENVIRONMENT,
      },
    },
  ],
  rooms: [
    {
      name: 'snap-room',
      doc: {
        schemaVersion: 5,
        name: 'snap-room',
        title: 'snap-room',
        updatedAt: 0,
        commands: [blueBlock('c1', [0, 0, 0]), blueBlock('c2', [1, 0, 0])],
        groups: {},
      },
    },
    {
      name: 'baked-room',
      doc: {
        schemaVersion: 5,
        name: 'baked-room',
        title: 'baked-room',
        updatedAt: 0,
        commands: [],
        groups: {},
        layoutName: 'baked-layout',
      },
    },
  ],
  layouts: [
    {
      name: 'baked-layout',
      doc: {
        schemaVersion: 1,
        name: 'baked-layout',
        updatedAt: 0,
        commands: [
          blueBlock('l1', [0, 0, 0]),
          blueBlock('l2', [1, 0, 0]),
          blueBlock('l3', [0, 0, 1]),
        ],
        groups: {},
      },
    },
  ],
};

/** Pixel count and centroid of the voice-zone overlay (translucent magenta) on the canvas. */
async function voiceZoneOverlay(page: Page, canvas: Locator) {
  const box = (await canvas.boundingBox())!;
  const png = PNG.sync.read(
    await page.screenshot({
      clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    }),
  );
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const [r, g, b] = [png.data[i], png.data[i + 1], png.data[i + 2]];
    if (r - g > 60 && b - g > 60) {
      const px = (i / 4) % png.width;
      count += 1;
      sumX += px;
      sumY += Math.floor(i / 4 / png.width);
    }
  }
  return {
    count,
    x: box.x + sumX / Math.max(count, 1),
    y: box.y + sumY / Math.max(count, 1),
  };
}

test('hermetic mode loads a seeded map and renders it', async ({ page }) => {
  await goToModeHermetic(page, 'map', SEED);
  const canvas = await waitForCanvasReady(page);

  // The seeded `default` map carries three room placements.
  await expect(page.getByText(/Placed rooms \(3\)/)).toBeVisible({
    timeout: 8_000,
  });

  // The canvas renders real geometry (not a frozen/empty buffer).
  const colors = await distinctColorsInCanvas(canvas);
  expect(colors).toBeGreaterThan(3);
});

test('hermetic mode exposes the explicit tool model', async ({ page }) => {
  await goToModeHermetic(page, 'map', SEED);
  await waitForCanvasReady(page);
  for (const label of ['Select', 'Move', 'Spawn']) {
    await expect(
      page.getByRole('button', { name: label, exact: true }),
    ).toBeVisible();
  }
});

test('voice zone toggle previews the footprint, follows rotate and move, and survives a map switch', async ({
  page,
}) => {
  await goToModeHermetic(page, 'map', SEED);
  const canvas = await waitForCanvasReady(page);
  const zoneSwitch = (id: string) =>
    page.getByTestId(`room-row-${id}`).getByRole('switch', { name: 'Voice zone' });
  const overlay = () => voiceZoneOverlay(page, canvas);

  await expect(page.getByText(/Placed rooms \(3\)/)).toBeVisible();
  expect((await overlay()).count).toBe(0);

  // Baked room: its geometry only exists in the layout.
  await zoneSwitch('inst-c').click();
  await expect.poll(async () => (await overlay()).count).toBeGreaterThan(200);
  const placed = await overlay();

  await page.getByTestId('room-row-inst-c').getByTitle('Rotate 90°').click();
  await expect
    .poll(async () => {
      const o = await overlay();
      return Math.hypot(o.x - placed.x, o.y - placed.y);
    })
    .toBeGreaterThan(12);

  // Move a placement with the Move tool; its overlay goes along.
  await zoneSwitch('inst-c').click();
  await expect.poll(async () => (await overlay()).count).toBe(0);
  await zoneSwitch('inst-a').click();
  await expect.poll(async () => (await overlay()).count).toBeGreaterThan(100);
  const before = await overlay();
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await page.mouse.move(before.x, before.y);
  await page.mouse.down();
  await page.mouse.move(before.x + 60, before.y + 30, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const o = await overlay();
      return Math.hypot(o.x - before.x, o.y - before.y);
    })
    .toBeGreaterThan(20);

  await page.locator('select').selectOption('other');
  await expect(page.getByText(/Placed rooms \(0\)/)).toBeVisible();
  await page.locator('select').selectOption('default');
  await expect(page.getByText(/Placed rooms \(3\)/)).toBeVisible();
  await expect(zoneSwitch('inst-a')).toBeChecked();
  await expect(zoneSwitch('inst-c')).not.toBeChecked();
  await expect.poll(async () => (await overlay()).count).toBeGreaterThan(100);
});
