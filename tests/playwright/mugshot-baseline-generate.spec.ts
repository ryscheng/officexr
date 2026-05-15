/**
 * One-shot generator for `tests/playwright/mugshot-baselines/
 * Barbarian/generated/`. Captures both cube modes (GLB +
 * primitive) × four cardinal angles = 8 PNGs, plus a refreshed
 * manifest.json at the directory root.
 *
 * Writes ONLY to `generated/`. The user's curated `ideal/`
 * subdirectory is never touched — protection by directory
 * boundary, not by env flag.
 *
 * Run explicitly:
 *   MUGSHOT_GENERATE=1 pnpm exec playwright test mugshot-baseline-generate
 *
 * `test.skip` keeps it out of `pnpm test:e2e` runs by default.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { waitForCanvasReady } from './helpers.ts';

const ANGLES = [
  { name: 'north', deg: 0 },
  { name: 'east', deg: 90 },
  { name: 'south', deg: 180 },
  { name: 'west', deg: 270 },
] as const;

type CubeMode = 'gltf' | 'primitive';

const CHAR_DIR = path.join(__dirname, 'mugshot-baselines', 'Barbarian');
const GENERATED_DIR = path.join(CHAR_DIR, 'generated');

test.skip(
  process.env.MUGSHOT_GENERATE !== '1',
  'set MUGSHOT_GENERATE=1 to regenerate generated/ baselines for Barbarian',
);

test('generate Barbarian mugshot baselines (generated/ subdir)', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(GENERATED_DIR, { recursive: true });

  // Read the curated manifest (if one exists) so the generated/
  // images use the same lighting / camera / viewport recipe the
  // ideal/ baselines were captured with. That way `generated/` is
  // "what the renderer produces TODAY against the canonical
  // recipe" — and any drift surfaces directly when humans diff
  // `generated/<name>.png` vs `ideal/<name>.png` in git. The
  // generator NEVER writes the manifest — it's a curated artifact
  // refreshed only by the in-app Export button.
  const manifestPath = path.join(CHAR_DIR, 'manifest.json');
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    : null;

  await page.goto('/#mugshot/Barbarian', { waitUntil: 'domcontentloaded' });
  await waitForCanvasReady(page, 0, 30_000);

  // Wait for all hooks to publish — SET_CUBE_MODE is the new one.
  await page.waitForFunction(
    () =>
      typeof (window as unknown as Record<string, unknown>)
        .__OFFICE_MUGSHOT_APPLY_MANIFEST__ === 'function' &&
      typeof (window as unknown as Record<string, unknown>)
        .__OFFICE_MUGSHOT_SET_AZIMUTH__ === 'function' &&
      typeof (window as unknown as Record<string, unknown>)
        .__OFFICE_MUGSHOT_SET_CUBE_MODE__ === 'function',
    null,
    { timeout: 15_000 },
  );

  if (manifest) {
    await page.evaluate((m) => {
      (
        window as unknown as {
          __OFFICE_MUGSHOT_APPLY_MANIFEST__: (m: unknown) => void;
        }
      ).__OFFICE_MUGSHOT_APPLY_MANIFEST__(m);
    }, manifest);
    await page.waitForTimeout(400);
  } else {
    await page.waitForTimeout(500);
  }

  for (const mode of ['gltf', 'primitive'] as const) {
    await page.evaluate((m) => {
      (
        window as unknown as {
          __OFFICE_MUGSHOT_SET_CUBE_MODE__: (m: CubeMode) => void;
        }
      ).__OFFICE_MUGSHOT_SET_CUBE_MODE__(m);
    }, mode);
    // setWorldObjects → ObjectInstances rebuild → next paint.
    await page.waitForTimeout(300);

    for (const angle of ANGLES) {
      await page.evaluate((deg) => {
        (
          window as unknown as {
            __OFFICE_MUGSHOT_SET_AZIMUTH__: (deg: number) => void;
          }
        ).__OFFICE_MUGSHOT_SET_AZIMUTH__(deg);
      }, angle.deg);
      await page.waitForTimeout(200);

      const dataUrl = await page.evaluate(() => {
        const c = document.querySelector('canvas') as HTMLCanvasElement | null;
        return c?.toDataURL('image/png') ?? null;
      });
      expect(dataUrl, `capture for ${mode} ${angle.name} returned null`).not.toBeNull();
      const buf = Buffer.from((dataUrl as string).split(',')[1] ?? '', 'base64');
      const fileName =
        mode === 'gltf'
          ? `${angle.name}.png`
          : `primitive-${angle.name}.png`;
      fs.writeFileSync(path.join(GENERATED_DIR, fileName), buf);
    }
  }

  console.log(`wrote 8 PNGs to ${GENERATED_DIR}`);
  console.log(
    manifest === null
      ? 'no manifest.json found — generated images used in-app defaults'
      : `applied recipe from ${manifestPath}`,
  );
  console.log(
    'ideal/ + manifest.json untouched. To update assertion targets, hand-pick from generated/ into ideal/. To update the recipe, use the in-app Export button.',
  );
});
