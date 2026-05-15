/**
 * Routing-level smoke. Verifies every mode tab is reachable, hash
 * sync works, and the API endpoints the studio depends on respond.
 */

import { expect, test } from '@playwright/test';
import { goToMode } from './helpers.ts';

test('all six mode tabs are present in the header', async ({ page }) => {
  await page.goto('/');
  for (const label of ['Map', 'Room', 'Object', 'Character', 'Debug', 'Mugshot']) {
    await expect(
      page.locator(`button[role="tab"]:has-text("${label}")`),
    ).toBeVisible();
  }
});

test('hash deep-link opens the matching mode', async ({ page }) => {
  for (const mode of ['map', 'room', 'object', 'character', 'debug', 'mugshot'] as const) {
    await goToMode(page, mode);
  }
});

test('storage endpoints respond', async ({ request }) => {
  for (const path of ['/api/rooms', '/api/maps', '/api/cube-kinds']) {
    const r = await request.get(`http://localhost:5174${path}`);
    expect(r.status(), `${path} status`).toBe(200);
    const body = await r.json();
    expect(body, `${path} non-empty body`).toBeTruthy();
  }
});
