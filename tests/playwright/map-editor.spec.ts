/**
 * Map editor regressions. Pins:
 *   - The editor mounts the three-pane layout with a working canvas.
 *   - The map picker exposes the saved-maps listing and a new-map input.
 *   - The room palette is populated from `/api/rooms`.
 *   - Adding a room from the palette creates a `RoomInstance` and the
 *     side panel's "Placed rooms" list reflects it.
 */

import { expect, test } from '@playwright/test';
import { goToMode, waitForCanvasReady } from './helpers.ts';

test('Map editor mounts canvas + RoomPalette + map dropdown', async ({ page }) => {
  await goToMode(page, 'map');
  await waitForCanvasReady(page);

  // RoomPalette header is "Rooms (N)".
  await expect(page.getByText(/Rooms \(\d+\)/)).toBeVisible();
  // MapPicker exposes a <select> + a new-map input.
  await expect(page.locator('select').first()).toBeVisible();
  await expect(page.getByPlaceholder('New map name…')).toBeVisible();
  // The Placed-rooms section is mounted (count >= 0).
  await expect(page.getByText(/Placed rooms \(\d+\)/)).toBeVisible();
  // The Spawn-points section is mounted.
  await expect(page.getByText(/Spawn points \(\d+\)/)).toBeVisible();
});

test('RoomPalette adds an instance when a room is clicked', async ({ page }) => {
  await goToMode(page, 'map');
  await waitForCanvasReady(page);

  // Author a brand-new map so the test doesn't pollute the seed
  // `default` file with each run. New maps start with 0 rooms +
  // 0 spawn points.
  const newMapName = `pw-test-${Date.now().toString(36)}`;
  await page.getByPlaceholder('New map name…').fill(newMapName);
  await page.getByRole('button', { name: '+', exact: true }).click();
  await expect(page.getByText(/Placed rooms \(0\)/)).toBeVisible({
    timeout: 6_000,
  });

  // Click the first room in the palette to drop a new instance.
  const firstRoomBtn = page
    .locator('button')
    .filter({ hasText: /^default(-v2)?$/ })
    .first();
  await firstRoomBtn.click();
  await expect(page.getByText(/Placed rooms \(1\)/)).toBeVisible({
    timeout: 6_000,
  });
});

test('Map toolbar exposes Select / Move / Spawn tools', async ({ page }) => {
  // The implicit "click a cube to drag" flow was replaced by an
  // explicit tool model (commit c606f10). The toolbar overlay must
  // render the three tools as aria-pressed buttons.
  await goToMode(page, 'map');
  await waitForCanvasReady(page);
  for (const label of ['Select', 'Move', 'Spawn']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
  // Select is the default active tool.
  await expect(
    page.getByRole('button', { name: 'Select', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('EnvironmentPanel renders Lighting / Sky / Stars / HDRI sections', async ({
  page,
}) => {
  await goToMode(page, 'map');
  await waitForCanvasReady(page);

  // The new EnvironmentPanel replaces the Leva tree in the side
  // panel. Each <Section> renders its title as an uppercase chip.
  await expect(page.getByText('Lighting', { exact: true })).toBeVisible();
  await expect(page.getByText('Sky', { exact: true })).toBeVisible();
  await expect(page.getByText('Stars', { exact: true })).toBeVisible();
  await expect(page.getByText('HDRI', { exact: true })).toBeVisible();

  // The "ambient" Field row should always be visible (it's inside
  // the always-open Lighting section).
  await expect(page.getByText('ambient', { exact: true })).toBeVisible();
});
