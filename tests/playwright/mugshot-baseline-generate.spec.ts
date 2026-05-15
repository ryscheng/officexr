/**
 * One-shot generator for the initial Barbarian mugshot baseline.
 * Drives the Mugshot mode through its 4 cardinal angles, captures
 * each via `canvas.toDataURL`, and writes them — plus the
 * manifest — directly to
 *   tests/playwright/mugshot-baselines/Barbarian/
 *
 * Run explicitly:
 *   pnpm exec playwright test mugshot-baseline-generate
 *
 * `test.skip` keeps it out of `pnpm test:e2e` runs by default
 * (gated by env). The user runs it once to seed the baselines,
 * reviews them visually, and commits. After that, the
 * mugshot-baseline-compare spec is the regression check.
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

const OUT_DIR = path.join(__dirname, 'mugshot-baselines', 'Barbarian');

test.skip(
  process.env.MUGSHOT_GENERATE !== '1',
  'set MUGSHOT_GENERATE=1 to regenerate the Barbarian baseline',
);

test('generate Barbarian mugshot baseline', async ({ page }) => {
  test.setTimeout(120_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  await page.goto('/#mugshot/Barbarian', { waitUntil: 'domcontentloaded' });
  await waitForCanvasReady(page, 0, 30_000);

  // Wait for the manifest-load hook to be published — it's set when
  // MugshotApp's useEffect runs, which happens after Scene mounts.
  await page.waitForFunction(
    () =>
      typeof (window as unknown as Record<string, unknown>)
        .__OFFICE_MUGSHOT_SET_AZIMUTH__ === 'function',
    null,
    { timeout: 15_000 },
  );

  // Let the Y-offset / gravity-off plumbing settle the body.
  await page.waitForTimeout(500);

  // Build the manifest from the live state. We don't have a
  // dedicated "read state" hook so we read the relevant bits off
  // the URL + capture the same constants MugshotApp uses for
  // defaults. The captured `pos.y` from `__OFFICE_STORE__` is the
  // load-bearing piece (it's what the user can tune via the slider).
  const live = await page.evaluate(() => {
    const store = (
      window as unknown as {
        __OFFICE_STORE__: {
          getState: () => {
            players: Record<string, { pos: { y: number } } | undefined>;
          };
        };
      }
    ).__OFFICE_STORE__;
    return store.getState().players['mugshot-player']?.pos.y;
  });

  // Capture each angle.
  const captured: Record<string, Buffer> = {};
  for (const angle of ANGLES) {
    await page.evaluate((deg) => {
      const fn = (
        window as unknown as {
          __OFFICE_MUGSHOT_SET_AZIMUTH__: (deg: number) => void;
        }
      ).__OFFICE_MUGSHOT_SET_AZIMUTH__;
      fn(deg);
    }, angle.deg);
    await page.waitForTimeout(200);
    const dataUrl = await page.evaluate(() => {
      const c = document.querySelector('canvas') as HTMLCanvasElement | null;
      return c?.toDataURL('image/png') ?? null;
    });
    expect(dataUrl, `capture for ${angle.name} returned null`).not.toBeNull();
    const b64 = (dataUrl as string).split(',')[1] ?? '';
    captured[angle.name] = Buffer.from(b64, 'base64');
  }

  // Write the manifest. Values mirror MugshotApp's defaults: this
  // is the baseline-from-defaults; a human can later regenerate it
  // via the in-app Export button with tuned settings.
  const manifest = {
    schemaVersion: 1,
    character: 'Barbarian',
    yOffset: live ?? 1.51,
    viewportWidth: 512,
    viewportHeight: 512,
    exportedAt: new Date().toISOString(),
    fixedCamera: {
      azimuthDeg: 180,
      pitchDeg: -8,
      height: 1.7,
      fov: 40,
      distanceM: 6,
    },
    lighting: {
      sunPosition: [20, 40, 20],
      sunColor: '#ffffff',
      sunIntensity: 1.4,
      ambientIntensity: 0.15,
      castShadow: true,
      shadowRange: 40,
      shadowMapSize: 2048,
      shadowBias: -0.0005,
      shadowNormalBias: 0.02,
      auxLightType: 'none',
      auxIntensity: 1,
      auxDistance: 0,
      auxAngle: Math.PI / 6,
      auxPenumbra: 0.2,
      auxDecay: 2,
      showSunDisc: false,
      sunDiscRadius: 3,
      sunDiscIntensity: 2,
    },
    background: {
      topColor: '#02030a',
      bottomColor: '#1a1238',
    },
  };
  fs.writeFileSync(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );
  for (const [name, buf] of Object.entries(captured)) {
    fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), buf);
  }

  console.log(`wrote Barbarian baseline to ${OUT_DIR}`);
});
