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

test('Object editor renders a preview canvas and the kind controls panel', async ({
  page,
}) => {
  await goToMode(page, 'object');

  // The preview canvas is the only <canvas> on the page.
  await expect(page.locator('canvas')).toBeVisible();

  // KindEditorPanel uses our control kit; each Field renders a
  // <label> with the field name. Verify the standard rows are
  // present.
  await expect(page.getByText('label', { exact: true })).toBeVisible();
  await expect(page.getByText('scale', { exact: true })).toBeVisible();
  await expect(page.getByText('walkable', { exact: true })).toBeVisible();
  await expect(page.getByText('category', { exact: true })).toBeVisible();
  // The "Kind" section header from <Section>.
  await expect(page.getByText('Kind', { exact: true })).toBeVisible();
});

test('Switching kinds does NOT clobber the new kind with previous kind values', async ({
  page,
  request,
}) => {
  // Regression canary, retained across the Leva → shadcn migration.
  // With Leva, switching kindA → kindB fired onChange with kindA's
  // stale cached value against kindB's handler, clobbering B's
  // catalog entry. The shadcn-based KindEditorPanel is fully
  // controlled (no module-level Leva store), so the bug class is
  // structurally impossible — but we keep the assertion so any
  // future regression that re-introduces an uncontrolled control
  // gets caught at the data-invariant level (catalog reads back
  // unchanged after a kind switch with no user typing).

  // Pick two distinct kinds from the catalog to switch between.
  const apiResp = await request.get('http://localhost:5174/api/cube-kinds');
  const apiBody = (await apiResp.json()) as {
    kinds: Array<{ id: string; label: string; scale: number; swatch: string }>;
  };
  expect(apiBody.kinds.length).toBeGreaterThanOrEqual(2);
  // Use the first two "block" kinds (the original 12 BlockBits are
  // always there) so the test is deterministic regardless of asset-
  // pack installation state.
  const kindA = apiBody.kinds[0];
  const kindB = apiBody.kinds.find(
    (k) => k.id !== kindA.id && k.label !== kindA.label,
  );
  expect(kindB, 'need a second distinct kind').toBeDefined();
  const a = kindA;
  const b = kindB!;
  const aLabelBefore = a.label;
  const bLabelBefore = b.label;
  expect(aLabelBefore).not.toBe(bLabelBefore);

  await goToMode(page, 'object');
  // Wait for catalog hydration.
  await expect(page.getByText(/Catalog \(\d+ kinds?\)/)).toBeVisible();

  // Click kindA in the KindList to select it.
  const aRow = page.locator('button[title="' + a.id + '"]').first();
  await aRow.click();

  // Click kindB.
  const bRow = page.locator('button[title="' + b.id + '"]').first();
  await bRow.click();

  // Give the debounced auto-save (500ms) a chance to NOT fire a
  // spurious PUT before we re-read the catalog from the server. If
  // the bug were present, switching A→B would have written A's label
  // into B's catalog entry and the auto-save would have persisted it.
  await page.waitForTimeout(900);

  const after = await request.get('http://localhost:5174/api/cube-kinds');
  const afterBody = (await after.json()) as {
    kinds: Array<{ id: string; label: string }>;
  };
  const aAfter = afterBody.kinds.find((k) => k.id === a.id);
  const bAfter = afterBody.kinds.find((k) => k.id === b.id);
  expect(aAfter, 'kind A still in catalog').toBeDefined();
  expect(bAfter, 'kind B still in catalog').toBeDefined();
  expect(aAfter!.label, "kind A's label unchanged by switching").toBe(aLabelBefore);
  expect(bAfter!.label, "kind B's label unchanged by switching").toBe(bLabelBefore);
});
