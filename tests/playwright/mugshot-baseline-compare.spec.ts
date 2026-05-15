/**
 * Manifest-driven mugshot regression. For each
 *   tests/playwright/mugshot-baselines/<Character>/manifest.json
 *   tests/playwright/mugshot-baselines/<Character>/ideal/<name>.png
 * applies the manifest into the live Mugshot mode (via
 * `window.__OFFICE_MUGSHOT_APPLY_MANIFEST__`), captures each angle
 * in each cube mode (GLB + primitive), and asserts pixel-near-
 * identical reproduction.
 *
 * Directory split:
 *   ideal/    — committed assertion targets (user-curated; can also
 *               start from `generated/` and be hand-promoted).
 *   generated/— most-recent tool output; never read by tests.
 *               Committed so humans can diff in git, never an
 *               assertion target.
 *
 * If a `(mode, angle)` pair's ideal PNG doesn't exist, that test
 * skips cleanly — so this spec is harmless against partial
 * baselines. Drop the unzipped `ideal/` subtree from the in-app
 * Export button into the character's directory to expand
 * coverage.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { pixelDiffCount, waitForCanvasReady } from './helpers.ts';

const BASELINE_ROOT = path.join(__dirname, 'mugshot-baselines');

const ANGLES = [
  { name: 'north', deg: 0 },
  { name: 'east', deg: 90 },
  { name: 'south', deg: 180 },
  { name: 'west', deg: 270 },
] as const;

type AngleName = (typeof ANGLES)[number]['name'];
type CubeMode = 'gltf' | 'primitive';

const CHARACTERS = [
  'Barbarian',
  'Knight',
  'Mage',
  'Ranger',
  'Rogue',
  'Rogue_Hooded',
] as const;

const PIXEL_THRESHOLD = 6;
// Tight enough to catch a real placement shift (a 1-pixel offset on
// a 512×512 frame moves several percent of the character's silhouette
// pixels). Loose enough to absorb the antialiasing jitter that always
// appears on edges between captures of essentially-identical scenes
// — the previous 0.001 threshold flagged 0.5% diffs that on
// inspection were just edge fuzz, not real rendering drift.
const MAX_DIFF_FRAC = 0.01;

function baselineFilename(mode: CubeMode, angle: AngleName): string {
  return mode === 'gltf' ? `${angle}.png` : `primitive-${angle}.png`;
}

interface Baseline {
  manifest: unknown;
  idealByMode: Record<CubeMode, Partial<Record<AngleName, Buffer>>>;
}

function loadBaseline(character: string): Baseline | null {
  const dir = path.join(BASELINE_ROOT, character);
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const idealByMode: Baseline['idealByMode'] = { gltf: {}, primitive: {} };
  for (const mode of ['gltf', 'primitive'] as const) {
    for (const angle of ANGLES) {
      const file = path.join(dir, 'ideal', baselineFilename(mode, angle.name));
      if (fs.existsSync(file)) {
        idealByMode[mode][angle.name] = fs.readFileSync(file);
      }
    }
  }
  return { manifest, idealByMode };
}

for (const character of CHARACTERS) {
  const baseline = loadBaseline(character);
  for (const mode of ['gltf', 'primitive'] as const) {
    for (const angle of ANGLES) {
      test(`mugshot ideal · ${character} · ${mode} · ${angle.name}`, async ({ page }) => {
        test.setTimeout(60_000);
        const expected = baseline?.idealByMode[mode][angle.name];
        test.skip(
          expected === undefined,
          `no ideal/${baselineFilename(mode, angle.name)} for ${character} — curate via the Export button + drop into ideal/`,
        );

        await page.goto(`/#mugshot/${character}`, {
          waitUntil: 'domcontentloaded',
        });
        await waitForCanvasReady(page, 0, 30_000);

        // Wait for all three window hooks to be published.
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

        // Apply manifest first — sets lighting/distance/viewport/etc.
        await page.evaluate((m) => {
          const fn = (
            window as unknown as {
              __OFFICE_MUGSHOT_APPLY_MANIFEST__: (m: unknown) => void;
            }
          ).__OFFICE_MUGSHOT_APPLY_MANIFEST__;
          fn(m);
        }, baseline!.manifest);
        await page.waitForTimeout(300);

        // Switch cube mode, then azimuth. Each setState triggers a
        // re-render; the worldObjects swap for cube-mode also rebuilds
        // ObjectInstances.
        await page.evaluate((m) => {
          (
            window as unknown as {
              __OFFICE_MUGSHOT_SET_CUBE_MODE__: (m: CubeMode) => void;
            }
          ).__OFFICE_MUGSHOT_SET_CUBE_MODE__(m);
        }, mode);
        await page.waitForTimeout(200);

        await page.evaluate((deg) => {
          (
            window as unknown as {
              __OFFICE_MUGSHOT_SET_AZIMUTH__: (deg: number) => void;
            }
          ).__OFFICE_MUGSHOT_SET_AZIMUTH__(deg);
        }, angle.deg);
        await page.waitForTimeout(150);

        const dataUrl = await page.evaluate(() => {
          const c = document.querySelector('canvas') as HTMLCanvasElement | null;
          return c?.toDataURL('image/png') ?? null;
        });
        expect(dataUrl, 'canvas.toDataURL() returned null').not.toBeNull();
        const capturedBuf = Buffer.from(
          (dataUrl as string).split(',')[1] ?? '',
          'base64',
        );

        const baselinePng = PNG.sync.read(expected as Buffer);
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
          `mugshot ideal diff · ${character} · ${mode} · ${angle.name}: ${diff}/${total} px (${(frac * 100).toFixed(3)}%)`,
        );

        if (frac > MAX_DIFF_FRAC) {
          const diffPng = new PNG({
            width: baselinePng.width,
            height: baselinePng.height,
          });
          for (let i = 0; i + 2 < baselinePng.data.length; i += 4) {
            const dr = Math.abs(baselinePng.data[i] - capturedPng.data[i]);
            const dg = Math.abs(baselinePng.data[i + 1] - capturedPng.data[i + 1]);
            const db = Math.abs(baselinePng.data[i + 2] - capturedPng.data[i + 2]);
            const heat = dr + dg + db;
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
          const stem = `${character}-${mode}-${angle.name}`;
          fs.writeFileSync(
            path.join(diffDir, `${stem}-diff.png`),
            PNG.sync.write(diffPng),
          );
          fs.writeFileSync(path.join(diffDir, `${stem}-actual.png`), capturedBuf);
          fs.writeFileSync(
            path.join(diffDir, `${stem}-expected.png`),
            expected as Buffer,
          );
        }

        expect(
          frac,
          `pixel-diff fraction ${(frac * 100).toFixed(3)}% exceeds ${(MAX_DIFF_FRAC * 100).toFixed(3)}% (see test-results/mugshot-diffs/)`,
        ).toBeLessThanOrEqual(MAX_DIFF_FRAC);
      });
    }
  }
}
