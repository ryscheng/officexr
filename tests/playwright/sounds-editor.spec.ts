import { expect, test } from '@playwright/test';
import { goToModeHermetic } from './helpers.ts';

test('uploads, lists and deletes a sound hermetically', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await goToModeHermetic(page, 'sounds');
  await expect(page.getByText('No sounds yet')).toBeVisible();

  await page.getByLabel('Upload MP3').setInputFiles('tests/playwright/fixtures/silence.mp3');
  await expect(page.getByText('silence', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Delete silence' }).click();
  await expect(page.getByText('No sounds yet')).toBeVisible();
});
