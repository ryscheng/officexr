#!/usr/bin/env tsx
/**
 * Programmatic bake driver.
 *
 * Navigates Playwright to the studio's headless `?op=bake` route,
 * awaits the `BakeRunner` component's completion sentinel, then reads
 * the measurement result off `window.__officexrBakeResults`. The page
 * does the actual work via `api.bake.measureAll()` — this script is
 * just transport.
 *
 * Replaces the prior click-walk implementation, which raced React
 * Suspense + drei's useGLTF cache and produced poisoned values
 * (duplicate dimensions across distinct kinds, stale {1,1,0.349}
 * reads for kinds that are actually 4×4×4 in their GLTF).
 *
 * Prerequisites: the studio dev server must be running.
 *   pnpm --filter @officexr/studio dev
 *
 * Usage: pnpm bake:dimensions
 */

import { chromium } from 'playwright';

const DEV_SERVER = process.env.BAKE_DEV_SERVER ?? 'http://localhost:5174';
const CATALOG_URL = `${DEV_SERVER}/api/world-object-kinds`;
const BAKE_URL = `${DEV_SERVER}/?op=bake`;

interface BakedDims {
  width: number;
  height: number;
  depth: number;
  localAABB: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
}

interface CatalogShape {
  schemaVersion: number;
  updatedAt: number;
  kinds: Array<{ id: string; [k: string]: unknown }>;
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

/** Sanity check: flag kindIds that share the same rounded (w,h,d). */
function findDuplicateDimensions(
  results: Record<string, BakedDims | null>,
): Array<{ key: string; ids: string[] }> {
  const buckets = new Map<string, string[]>();
  for (const [id, dims] of Object.entries(results)) {
    if (!dims) continue;
    const key = `${dims.width.toFixed(3)}×${dims.height.toFixed(3)}×${dims.depth.toFixed(3)}`;
    let arr = buckets.get(key);
    if (!arr) {
      arr = [];
      buckets.set(key, arr);
    }
    arr.push(id);
  }
  const dups: Array<{ key: string; ids: string[] }> = [];
  for (const [key, ids] of buckets) {
    if (ids.length > 1) dups.push({ key, ids });
  }
  return dups;
}

async function main() {
  console.log('[bake-dimensions] Fetching current catalog…');
  const catalog = await fetchCatalog();

  console.log('[bake-dimensions] Launching headless browser…');
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROME_PATH ?? chromePath,
  });
  const page = await browser.newPage();

  page.on('pageerror', (e) => console.warn('[bake-dimensions] PAGEERR:', e.message));

  console.log(`[bake-dimensions] Navigating to ${BAKE_URL}`);
  await page.goto(BAKE_URL);

  // BakeRunner sets window.__officexrBakeDone = true when it finishes.
  await page.waitForFunction(
    () => (window as unknown as { __officexrBakeDone?: boolean }).__officexrBakeDone === true,
    null,
    { timeout: 120_000 },
  );

  const results = (await page.evaluate(
    () =>
      (window as unknown as {
        __officexrBakeResults?: Record<string, BakedDims | null>;
      }).__officexrBakeResults ?? null,
  )) as Record<string, BakedDims | null> | null;

  await browser.close();

  if (!results) {
    console.error('[bake-dimensions] No results object — BakeRunner did not complete?');
    process.exit(1);
  }

  const okCount = Object.values(results).filter((d) => d !== null).length;
  const failCount = Object.values(results).filter((d) => d === null).length;
  console.log(`[bake-dimensions] Measured ${okCount} kinds; ${failCount} failed.`);

  if (okCount === 0) {
    console.error('[bake-dimensions] No kinds measured — refusing to overwrite catalog.');
    process.exit(1);
  }

  // Sanity check: distinct kinds with identical dims is suspicious but
  // not strictly an error (the "block" family genuinely shares 2×2×2).
  // Print but do not abort.
  const dups = findDuplicateDimensions(results);
  if (dups.length > 0) {
    console.warn('[bake-dimensions] Duplicate-dimension buckets (informational):');
    for (const d of dups.slice(0, 10)) {
      console.warn(`  ${d.key}: ${d.ids.length} kinds (${d.ids.slice(0, 4).join(', ')}${d.ids.length > 4 ? '…' : ''})`);
    }
  }

  // Merge baked dims + localAABB into the existing catalog. Preserve
  // every other field on each kind so author-edited tilingAxes / scale
  // / etc. don't get clobbered.
  const nextCatalog: CatalogShape = {
    ...catalog,
    updatedAt: Date.now(),
    kinds: catalog.kinds.map((k) => {
      const m = results[k.id];
      if (!m) return k;
      return {
        ...k,
        dimensions: { width: m.width, height: m.height, depth: m.depth },
        localAABB: m.localAABB,
      };
    }),
  };

  console.log(`[bake-dimensions] PUT ${CATALOG_URL}`);
  await putCatalog(nextCatalog);
  console.log('[bake-dimensions] Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
