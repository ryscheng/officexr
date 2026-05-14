/**
 * Object editor regressions. Pins the bug we just fixed (catalog
 * hydration depended on visiting a route that called `useCubeCatalog()`)
 * so it can't sneak back.
 */

import { expect, test } from '@playwright/test';
import { goToMode } from './helpers.ts';

test('Object editor hydrates the full catalog from /api/cube-kinds', async ({
  page,
  request,
}) => {
  // Source of truth: the catalog the dev server serves.
  const apiResp = await request.get('http://localhost:5174/api/cube-kinds');
  const apiBody = (await apiResp.json()) as { kinds?: unknown[] };
  const expectedKindCount = apiBody.kinds?.length ?? 0;
  expect(expectedKindCount).toBeGreaterThan(0);

  await goToMode(page, 'object');

  // The header reads "Catalog — N kinds". Use a relaxed match so the
  // wording can change as long as the count is right.
  const header = page.locator('h2', { hasText: 'Catalog' });
  await expect(header).toContainText(String(expectedKindCount));
});

test('Object editor shows category counts that sum to the catalog total', async ({
  page,
  request,
}) => {
  const apiResp = await request.get('http://localhost:5174/api/cube-kinds');
  const apiBody = (await apiResp.json()) as { kinds?: { category: string }[] };
  const expectedTotal = apiBody.kinds?.length ?? 0;

  await goToMode(page, 'object');

  // Scrape the category row counts.
  const counts = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('div'))
      .filter(
        (d) =>
          d.children.length === 2 &&
          d.children[0].tagName === 'SPAN' &&
          d.children[1].tagName === 'SPAN',
      )
      .map((d) => Number(d.children[1].textContent || 0));
  });
  const sum = counts.reduce((s, n) => s + n, 0);
  expect(sum, 'category row counts sum to API total').toBe(expectedTotal);
});
