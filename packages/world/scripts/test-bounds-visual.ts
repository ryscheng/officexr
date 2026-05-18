#!/usr/bin/env tsx
/**
 * Visual regression test driver for the headless bounds scenes.
 *
 * Navigates Playwright to `/?op=bounds-scene&scene=<id>`, waits for
 * the scene's frame-painted sentinel, captures the canvas pixels via
 * `toDataURL`, and diffs against a checked-in baseline PNG using
 * pixelmatch.
 *
 * Prerequisites: the studio dev server must be running.
 *   pnpm --filter @officexr/studio dev
 *
 * Usage:
 *   pnpm --filter @officexr/world test:bounds-visual
 *   pnpm --filter @officexr/world test:bounds-visual --update   # rewrites baselines
 */
import { chromium } from 'playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const DEV_SERVER = process.env.BOUNDS_DEV_SERVER ?? 'http://localhost:5174';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = path.resolve(__dirname, 'test-bounds');
const UPDATE = process.argv.includes('--update');
// Fraction of pixels permitted to differ. Anti-aliasing + GPU drift
// produce non-zero diffs even on identical scenes; ~0.5% is the
// usual headroom for canvas-toDataURL captures.
const PIXEL_DIFF_TOLERANCE = 0.005;
const SCENES = ['blue-and-large-a'];

function dataUrlToPng(dataUrl: string): Buffer {
  const match = /^data:image\/png;base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error('toDataURL did not return a PNG payload');
  return Buffer.from(match[1], 'base64');
}

async function captureScene(sceneId: string): Promise<Buffer> {
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROME_PATH ?? chromePath,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 512, height: 512 },
    });
    page.on('pageerror', (e) => console.warn(`[bounds-visual] PAGEERR: ${e.message}`));
    const url = `${DEV_SERVER}/?op=bounds-scene&scene=${encodeURIComponent(sceneId)}`;
    await page.goto(url);

    await page.waitForFunction(
      () => (window as unknown as { __officexrBoundsReady?: boolean }).__officexrBoundsReady === true,
      null,
      { timeout: 30_000 },
    );
    // Give one extra animation frame for any post-load settling.
    await page.waitForTimeout(100);

    const dataUrl = await page.evaluate(() => {
      const c = document.querySelector('canvas') as HTMLCanvasElement | null;
      return c ? c.toDataURL('image/png') : null;
    });
    if (!dataUrl) throw new Error('no canvas on the page');
    return dataUrlToPng(dataUrl);
  } finally {
    await browser.close();
  }
}

function decode(buf: Buffer): PNG {
  return PNG.sync.read(buf);
}

async function runScene(sceneId: string): Promise<boolean> {
  console.log(`[bounds-visual] capturing ${sceneId}…`);
  const actualBuf = await captureScene(sceneId);
  const baselinePath = path.join(BASELINE_DIR, `${sceneId}.png`);
  const diffPath = path.join(BASELINE_DIR, `${sceneId}.diff.png`);

  if (UPDATE || !fs.existsSync(baselinePath)) {
    fs.mkdirSync(BASELINE_DIR, { recursive: true });
    fs.writeFileSync(baselinePath, actualBuf);
    console.log(`[bounds-visual] wrote baseline → ${baselinePath}`);
    return true;
  }

  const expected = decode(fs.readFileSync(baselinePath));
  const actual = decode(actualBuf);
  if (expected.width !== actual.width || expected.height !== actual.height) {
    console.error(
      `[bounds-visual] FAIL ${sceneId}: dimensions differ — expected ` +
        `${expected.width}x${expected.height}, got ${actual.width}x${actual.height}`,
    );
    return false;
  }

  const diff = new PNG({ width: expected.width, height: expected.height });
  const mismatched = pixelmatch(
    expected.data,
    actual.data,
    diff.data,
    expected.width,
    expected.height,
    { threshold: 0.1, alpha: 0 },
  );
  const total = expected.width * expected.height;
  const fraction = mismatched / total;
  if (fraction > PIXEL_DIFF_TOLERANCE) {
    fs.writeFileSync(diffPath, PNG.sync.write(diff));
    console.error(
      `[bounds-visual] FAIL ${sceneId}: ${mismatched}/${total} pixels differ ` +
        `(${(fraction * 100).toFixed(3)}% > ${(PIXEL_DIFF_TOLERANCE * 100).toFixed(3)}%). ` +
        `Diff written to ${diffPath}`,
    );
    return false;
  }
  console.log(
    `[bounds-visual] ok ${sceneId}: ${mismatched}/${total} (${(fraction * 100).toFixed(3)}%)`,
  );
  return true;
}

async function main() {
  let ok = true;
  for (const s of SCENES) {
    const passed = await runScene(s);
    if (!passed) ok = false;
  }
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
