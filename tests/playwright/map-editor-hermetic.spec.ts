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

import { expect, test } from '@playwright/test';
import {
  goToModeHermetic,
  waitForCanvasReady,
  distinctColorsInCanvas,
} from './helpers.ts';

// A map named `default` (the hook's default-open name) with two room
// instances. The room uses the `__primitive_blue` magic kind so it
// renders without a GLTF fetch. Plain JSON so it survives addInitScript.
const SEED = {
  maps: [
    {
      name: 'default',
      doc: {
        schemaVersion: 1,
        name: 'default',
        title: 'Default',
        updatedAt: 0,
        rooms: [
          { id: 'inst-a', roomName: 'snap-room', position: [0, 0, 0], rotationY: 0 },
          { id: 'inst-b', roomName: 'snap-room', position: [6, 0, 0], rotationY: 0 },
        ],
        spawnPoints: [],
        environment: {
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
        },
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
        commands: [
          { id: 'c1', op: 'placeObject', kindId: '__primitive_blue', position: [0, 0, 0] },
          { id: 'c2', op: 'placeObject', kindId: '__primitive_blue', position: [1, 0, 0] },
        ],
        groups: {},
      },
    },
  ],
};

test('hermetic mode loads a seeded map and renders it', async ({ page }) => {
  await goToModeHermetic(page, 'map', SEED);
  const canvas = await waitForCanvasReady(page);

  // The seeded `default` map carries two room instances.
  await expect(page.getByText(/Placed rooms \(2\)/)).toBeVisible({
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
