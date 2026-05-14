/**
 * Object editor regressions. Pins the bug we fixed (catalog
 * hydration depended on visiting a route that called `useCubeCatalog()`)
 * and verifies the editor's three-pane UI mounts with a populated
 * KindList + a 3D preview canvas.
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

  // KindList renders "Catalog (N kinds)" in a header div. Use a
  // relaxed text match so the wording can change as long as the count
  // is right.
  await expect(page.getByText(/Catalog \(\d+ kinds?\)/)).toContainText(
    String(expectedKindCount),
  );
});

test('Object editor sums category row counts to the catalog total', async ({
  page,
  request,
}) => {
  const apiResp = await request.get('http://localhost:5174/api/cube-kinds');
  const apiBody = (await apiResp.json()) as { kinds?: { category: string }[] };
  const expectedTotal = apiBody.kinds?.length ?? 0;

  await goToMode(page, 'object');

  // Wait for catalog hydration. Until that resolves, the category
  // buttons aren't mounted and the scraped sum is 0.
  await expect(page.getByText(/Catalog \(\d+ kinds?\)/)).toContainText(
    String(expectedTotal),
  );

  // KindList renders each category header as a <button> whose right
  // span is the count followed by a collapse arrow ("12 ▾" / "12 ▸").
  // Read out the trailing integer prefix to ignore the arrow.
  const counts = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button'))
      .map((b) => {
        if (b.children.length !== 2) return null;
        const right = b.children[1] as HTMLElement;
        const m = (right.textContent || '').trim().match(/^(\d+)/);
        return m ? Number(m[1]) : null;
      })
      .filter((n): n is number => n !== null);
  });
  const sum = counts.reduce((s, n) => s + n, 0);
  expect(sum, 'category row counts sum to API total').toBe(expectedTotal);
});

test('Object editor renders a preview canvas and Leva kind controls', async ({
  page,
}) => {
  await goToMode(page, 'object');

  // The preview canvas is the only <canvas> on the page.
  await expect(page.locator('canvas')).toBeVisible();

  // Leva renders into the SidePanel when `<Leva fill flat>` is used.
  // The KindEditor hook registers a "Kind" folder; verify its
  // standard fields are visible. Field labels are rendered as
  // <label> elements by Leva.
  await expect(page.getByText('label', { exact: true })).toBeVisible();
  await expect(page.getByText('scale', { exact: true })).toBeVisible();
  await expect(page.getByText('walkable', { exact: true })).toBeVisible();
});
