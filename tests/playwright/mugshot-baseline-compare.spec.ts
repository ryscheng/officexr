/**
 * Manifest-driven mugshot regression. Reads
 *   tests/playwright/mugshot-baselines/<Character>/manifest.json
 *   tests/playwright/mugshot-baselines/<Character>/{north,east,south,west}.png
 * applies the manifest into the live Mugshot mode (via
 * `window.__OFFICE_MUGSHOT_APPLY_MANIFEST__`), captures each angle,
 * and asserts pixel-near-identical reproduction.
 *
 * Baselines are produced by the in-app "Export for test" button.
 * Drop the unzipped contents into the directory above and commit.
 * If no baselines exist yet for a character, those tests are
 * skipped — so this spec is harmless before the user generates the
 * first export.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { pixelDiffCount, waitForCanvasReady } from './helpers.ts';

const BASELINE_ROOT = path.join(
  __dirname,
  'mugshot-baselines',
);

const ANGLES = [
  { name: 'north', deg: 0 },
  { name: 'east', deg: 90 },
  { name: 'south', deg: 180 },
  { name: 'west', deg: 270 },
] as const;

const CHARACTERS = [
  'Barbarian',
  'Knight',
  'Mage',
  'Ranger',
  'Rogue',
  'Rogue_Hooded',
] as const;

/** Pixel-diff threshold: per-pixel channel-sum delta tolerated. 6
 * is tight enough to catch any real rendering drift while
 * absorbing sub-byte rounding from PNG roundtrip. */
const PIXEL_THRESHOLD = 6;
/** Max fraction of pixels allowed to differ. 0.1% = 262 px on a
 * 512×512 frame — anything more means the rendering is meaningfully
 * different from the baseline. */
const MAX_DIFF_FRAC = 0.001;

interface Baseline {
  manifest: unknown;
  pngs: Record<string, Buffer>;
}

function loadBaseline(character: string): Baseline | null {
  const dir = path.join(BASELINE_ROOT, character);
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const pngs: Record<string, Buffer> = {};
  for (const angle of ANGLES) {
    const pngPath = path.join(dir, `${angle.name}.png`);
    if (!fs.existsSync(pngPath)) return null;
    pngs[angle.name] = fs.readFileSync(pngPath);
  }
  return { manifest, pngs };
}

for (const character of CHARACTERS) {
  const baseline = loadBaseline(character);
  for (const angle of ANGLES) {
    test(`mugshot baseline reproduces · ${character} · ${angle.name}`, async ({ page }) => {
      test.setTimeout(60_000);
      test.skip(
        baseline === null,
        `no baseline at tests/playwright/mugshot-baselines/${character}/ — generate via the Export button`,
      );

      await page.goto(`/#mugshot/${character}`, {
        waitUntil: 'domcontentloaded',
      });
      await waitForCanvasReady(page, 0, 30_000);

      // Wait for both window hooks to be published. They're set
      // synchronously in MugshotApp's useEffect chain — but Scene
      // mounts asynchronously after the in-memory stack resolves.
      await page.waitForFunction(
        () =>
          typeof (window as unknown as Record<string, unknown>)
            .__OFFICE_MUGSHOT_APPLY_MANIFEST__ === 'function' &&
          typeof (window as unknown as Record<string, unknown>)
            .__OFFICE_MUGSHOT_SET_AZIMUTH__ === 'function',
        null,
        { timeout: 15_000 },
      );

      // Apply the manifest's settings (lighting, distance, viewport
      // size, Y offset, character). The character was already
      // picked via the URL; the apply-manifest hook respects
      // whatever the manifest says.
      await page.evaluate((m) => {
        const fn = (
          window as unknown as {
            __OFFICE_MUGSHOT_APPLY_MANIFEST__: (m: unknown) => void;
          }
        ).__OFFICE_MUGSHOT_APPLY_MANIFEST__;
        fn(m);
      }, baseline!.manifest);

      // Settle React + R3F after the manifest applies.
      await page.waitForTimeout(300);

      // Set the per-angle azimuth and let the camera commit.
      await page.evaluate((deg) => {
        const fn = (
          window as unknown as {
            __OFFICE_MUGSHOT_SET_AZIMUTH__: (deg: number) => void;
          }
        ).__OFFICE_MUGSHOT_SET_AZIMUTH__;
        fn(deg);
      }, angle.deg);
      // Two RAFs for the new viewConfig to flow into CameraRig +
      // the next frame to be rendered. The shadow camera also
      // settles in a frame or two after the camera stops moving.
      await page.waitForTimeout(150);

      // Capture the live canvas as a PNG.
      const dataUrl = await page.evaluate(() => {
        const c = document.querySelector('canvas') as HTMLCanvasElement | null;
        return c?.toDataURL('image/png') ?? null;
      });
      expect(dataUrl, 'canvas.toDataURL() returned null').not.toBeNull();
      const capturedBuf = Buffer.from(
        (dataUrl as string).split(',')[1] ?? '',
        'base64',
      );

      // Decode baseline + captured PNGs.
      const baselinePng = PNG.sync.read(baseline!.pngs[angle.name]);
      const capturedPng = PNG.sync.read(capturedBuf);
      expect(capturedPng.width).toBe(baselinePng.width);
      expect(capturedPng.height).toBe(baselinePng.height);

      const diff = pixelDiffCount(
        baselinePng.data,
        capturedPng.data,
        PIXEL_THRESHOLD,
      );
      const total = baselinePng.width * baselinePng.height;
      const frac = diff / total;
      console.log(
        `mugshot baseline diff · ${character} · ${angle.name}: ${diff}/${total} px (${(frac * 100).toFixed(3)}%)`,
      );

      // Write a diff visualization PNG for failure diagnosis (only
      // when over budget — otherwise we don't litter test-results).
      if (frac > MAX_DIFF_FRAC) {
        const diffPng = new PNG({
          width: baselinePng.width,
          height: baselinePng.height,
        });
        for (let i = 0; i + 2 < baselinePng.data.length; i += 4) {
          const dr = Math.abs(baselinePng.data[i] - capturedPng.data[i]);
          const dg = Math.abs(
            baselinePng.data[i + 1] - capturedPng.data[i + 1],
          );
          const db = Math.abs(
            baselinePng.data[i + 2] - capturedPng.data[i + 2],
          );
          const heat = dr + dg + db;
          // Red for "differs", grey for "matches".
          diffPng.data[i] = heat > PIXEL_THRESHOLD ? 255 : 64;
          diffPng.data[i + 1] = heat > PIXEL_THRESHOLD ? 0 : 64;
          diffPng.data[i + 2] = heat > PIXEL_THRESHOLD ? 0 : 64;
          diffPng.data[i + 3] = 255;
        }
        const diffDir = path.join(
          __dirname,
          '..',
          '..',
          'test-results',
          'mugshot-diffs',
        );
        fs.mkdirSync(diffDir, { recursive: true });
        fs.writeFileSync(
          path.join(diffDir, `${character}-${angle.name}-diff.png`),
          PNG.sync.write(diffPng),
        );
        fs.writeFileSync(
          path.join(diffDir, `${character}-${angle.name}-actual.png`),
          capturedBuf,
        );
        fs.writeFileSync(
          path.join(diffDir, `${character}-${angle.name}-expected.png`),
          baseline!.pngs[angle.name],
        );
      }

      expect(
        frac,
        `pixel-diff fraction ${(frac * 100).toFixed(3)}% exceeds ${(MAX_DIFF_FRAC * 100).toFixed(3)}% (see test-results/mugshot-diffs/)`,
      ).toBeLessThanOrEqual(MAX_DIFF_FRAC);
    });
  }
}
