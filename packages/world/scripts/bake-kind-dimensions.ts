#!/usr/bin/env tsx
/**
 * Bakes per-kind GLTF-derived bounding-box dimensions into the
 * world-object-kind catalog. After this runs, every kind in
 * `packages/world/world-object-kinds.json` has a `dimensions` field
 * populated from its GLTF AABB extents (post-`scale`).
 *
 * Why this matters:
 *   - `compileScene` uses `getKindStride(kindId, voxelSize)` to step
 *     extrude commands by the kind's actual bounding-box voxels.
 *   - The tile tool steps and snaps to multiples of the kind's dims.
 *   - The Object Editor shows "baked" instead of "unbaked".
 * Without baked dimensions every kind falls back to a 1-voxel step
 * (legacy behaviour) — which on the 0.5 m grid means 2 m blocks
 * overlap when extruded.
 *
 * Prerequisites: the studio dev server must be running
 *   (default http://localhost:5174 — set BAKE_DEV_SERVER to override).
 *   Run `pnpm --filter @officexr/studio dev` first.
 *
 * Usage: pnpm bake:dimensions
 *
 * The script:
 *   1. Fetches the current catalog from /api/world-object-kinds.
 *   2. Drives Playwright to the Object editor, clicks each kind, and
 *      reads the `data-measured-dims` attribute on the Dimensions
 *      section (set by ObjectKindEditorPanel).
 *   3. Builds a new catalog where every kind has the baked dimensions
 *      merged in (preserves any other fields the author has edited).
 *   4. PUTs the new catalog to /api/world-object-kinds.
 *
 * On failure for a specific kind, logs a warning, leaves that kind's
 * dimensions unchanged, and continues. Prints a summary at the end.
 */

import { chromium } from 'playwright';

const DEV_SERVER = process.env.BAKE_DEV_SERVER ?? 'http://localhost:5174';
const CATALOG_URL = `${DEV_SERVER}/api/world-object-kinds`;

interface BakedDims {
  width: number;
  height: number;
  depth: number;
}

interface KindShape {
  id: string;
  label: string;
  category: string;
  dimensions?: BakedDims;
  [k: string]: unknown;
}

interface CatalogShape {
  schemaVersion: number;
  updatedAt: number;
  kinds: KindShape[];
}

async function fetchCatalog(): Promise<CatalogShape> {
  let res: Response;
  try {
    res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(5000) });
  } catch {
    console.error(
      `\n[bake-dimensions] ERROR: Could not reach the dev server at ${DEV_SERVER}.`,
      '\nMake sure the studio dev server is running:',
      '\n  pnpm --filter @officexr/studio dev\n',
    );
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`[bake-dimensions] ERROR: GET ${CATALOG_URL} returned ${res.status}.`);
    process.exit(1);
  }
  return (await res.json()) as CatalogShape;
}

async function putCatalog(catalog: CatalogShape): Promise<void> {
  const res = await fetch(CATALOG_URL, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(catalog),
  });
  if (!res.ok) {
    throw new Error(`PUT ${CATALOG_URL} returned ${res.status}`);
  }
}

async function main() {
  console.log(`[bake-dimensions] Fetching catalog from ${CATALOG_URL}...`);
  const catalog = await fetchCatalog();
  const allKinds = catalog.kinds;
  // Character kinds are not placeable objects — skip the bake (they're
  // not selectable in the Object editor's kind list either).
  const kinds = allKinds.filter((k) => k.category !== 'character');
  console.log(
    `[bake-dimensions] ${allKinds.length} kinds total, ${allKinds.length - kinds.length} 'character' skipped.`,
  );

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const objectUrl = `${DEV_SERVER}/#object`;
  console.log(`[bake-dimensions] Navigating to ${objectUrl}...`);
  await page.goto(objectUrl);

  // Wait for the page to stabilize.
  await page.waitForTimeout(2000);

  const bakedById = new Map<string, BakedDims>();
  let okCount = 0;
  let failCount = 0;

  for (const kind of kinds) {
    try {
      const kindBtn = page.locator(`[data-kind-id="${kind.id}"]`);
      let count = await kindBtn.count();
      if (count === 0) {
        // The kind list collapses categories — expand the matching one.
        const collapseBtn = page.locator('button').filter({ hasText: kind.category });
        if ((await collapseBtn.count()) > 0) {
          await collapseBtn.first().click();
          await page.waitForTimeout(80);
        }
        count = await kindBtn.count();
        if (count === 0) {
          console.warn(`[bake-dimensions] WARN: kind "${kind.id}" not found. Skipping.`);
          failCount++;
          continue;
        }
      }

      await kindBtn.first().click();
      // Wait for the dimensions section to populate (data-measured-dims
      // is rendered by KindDimensionsEditor once the GLTF is loaded).
      const dimsLocator = page.locator('[data-measured-dims]');
      await dimsLocator.first().waitFor({ state: 'attached', timeout: 8000 });

      // Re-read on a short retry loop — the panel may be momentarily
      // empty as Suspense unsuspends between kinds.
      let raw: string | null = null;
      for (let i = 0; i < 15; i++) {
        raw = await dimsLocator.first().getAttribute('data-measured-dims');
        if (raw && raw.split(',').every((s) => Number.isFinite(parseFloat(s)))) break;
        await page.waitForTimeout(120);
      }
      if (!raw) {
        console.warn(`[bake-dimensions] WARN: kind "${kind.id}" produced no dims. Skipping.`);
        failCount++;
        continue;
      }

      const parts = raw.split(',').map((s) => parseFloat(s));
      if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p) || p <= 0)) {
        console.warn(`[bake-dimensions] WARN: kind "${kind.id}" invalid dims "${raw}". Skipping.`);
        failCount++;
        continue;
      }
      const [width, height, depth] = parts as [number, number, number];
      bakedById.set(kind.id, { width, height, depth });
      okCount++;
      if (okCount % 25 === 0) {
        console.log(`[bake-dimensions] Progress: ${okCount}/${kinds.length} measured...`);
      }
    } catch (err) {
      console.warn(`[bake-dimensions] WARN: kind "${kind.id}" failed:`, err);
      failCount++;
    }
  }

  await browser.close();

  console.log(`[bake-dimensions] Measured ${okCount} kinds, ${failCount} failed.`);
  if (okCount === 0) {
    console.error('[bake-dimensions] No kinds measured — refusing to overwrite catalog.');
    process.exit(1);
  }

  // Merge baked dims into the existing catalog (preserving any other
  // edits the author has made). Skipped/failed kinds keep whatever
  // dimensions field they already had (which may be undefined).
  const nextCatalog: CatalogShape = {
    ...catalog,
    updatedAt: Date.now(),
    kinds: catalog.kinds.map((k) => {
      const baked = bakedById.get(k.id);
      if (!baked) return k;
      return { ...k, dimensions: baked };
    }),
  };

  console.log(`[bake-dimensions] PUT ${CATALOG_URL}...`);
  await putCatalog(nextCatalog);
  console.log('[bake-dimensions] Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
