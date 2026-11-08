/**
 * Object editor model upload panel in hermetic mode (`?test=1`): a fake
 * `ModelSourcesClient` stands in for the REST API and GCS, so the whole
 * pick -> upload -> finalize -> catalog refresh flow runs without a backend.
 */

import { expect, test } from '@playwright/test';
import { goToModeHermetic } from './helpers.ts';

test('uploads a folder, finalizes only the entries, and lists the new kinds', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __OFFICEXR_TEST_SEED__: Record<string, unknown>; __puts: string[] };
    w.__puts = [];
    let finalizeCalls = 0;
    w.__OFFICEXR_TEST_SEED__ = {
      modelSourcesClient: {
        requestUploadUrls: async (_pack: string, files: { path: string }[]) =>
          files.map((f) => ({ path: f.path, url: `fake://${f.path}`, method: 'PUT', headers: {} })),
        put: async (target: { path: string }) => {
          w.__puts.push(target.path);
        },
        finalize: async (_pack: string, entry: string) => {
          // First call is busy so the "studio busy" state is exercised.
          if (finalizeCalls++ === 0) {
            const { StudioBusyError } = await import('/src/modes/object/upload/modelSourcesClient.ts');
            throw new StudioBusyError();
          }
          return {
            id: `uploaded/${entry}`,
            label: `Uploaded ${entry}`,
            category: 'furniture',
            gltfPath: `/models/${entry}?v=1`,
          };
        },
      },
    };
  });
  await goToModeHermetic(page, 'object');

  await page.getByRole('button', { name: 'Upload models' }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload models' });
  await dialog.getByLabel('Pack name').fill('office');
  const png = Buffer.from('png');
  await dialog.getByLabel('Pick files').setInputFiles([
    { name: 'chair.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from('glb') },
    { name: 'tex.png', mimeType: 'image/png', buffer: png },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('no') },
  ]);

  await expect(dialog.getByTestId('upload-row')).toHaveCount(2);
  await dialog.getByRole('button', { name: /Upload 2 files/ }).click();

  await expect(dialog.locator('[data-path="chair.glb"]')).toContainText('done: uploaded/chair.glb', {
    timeout: 15_000,
  });
  await expect(dialog.locator('[data-path="tex.png"]')).toContainText('uploaded');
  expect(await page.evaluate(() => (window as unknown as { __puts: string[] }).__puts.sort())).toEqual([
    'chair.glb',
    'tex.png',
  ]);

  await page.getByPlaceholder(/filter/i).fill('uploaded/chair');
  await expect(page.getByText('Uploaded chair.glb')).toBeVisible();
});
