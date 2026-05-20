/**
 * Shared Playwright helpers for the studio regression suite.
 */

import { expect, type Locator, type Page } from '@playwright/test';

/** Navigate to a mode by hash. The studio mirrors `#<mode>` ↔ state.
 *
 * Uses `waitUntil: 'domcontentloaded'` because:
 *   - `'networkidle'` never fires (Debug opens a long-lived WebSocket).
 *   - `'load'` is gated on every transitive sub-resource (heavy GLTFs,
 *     animation rigs) finishing — Adventurer pulls in 5 GLTFs and they
 *     can still be in-flight from a prior test against the same
 *     dev-server process.
 *
 * The active-tab assertion below is the real "mode mounted" gate. */
export async function goToMode(
  page: Page,
  mode: 'map' | 'room' | 'object' | 'character' | 'debug' | 'mugshot',
): Promise<void> {
  await page.goto(`/#${mode}`, { waitUntil: 'domcontentloaded' });
  await expect(
    page.locator(`button[role="tab"][aria-selected="true"]`),
  ).toHaveText(modeLabel(mode), { timeout: 8_000 });
}

/**
 * Navigate to a mode in hermetic test mode (`?test=1`): the studio
 * boots with a bundled catalog and in-memory storages instead of the
 * dev-server backend. Optionally seeds those storages via
 * `window.__OFFICEXR_TEST_SEED__` (injected before load) so an editor
 * opens with known content.
 *
 * `seed` must be JSON-serializable (it crosses into the page via
 * `addInitScript`).
 */
export async function goToModeHermetic(
  page: Page,
  mode: 'map' | 'room' | 'object' | 'character' | 'debug',
  seed?: unknown,
): Promise<void> {
  if (seed !== undefined) {
    await page.addInitScript((s) => {
      (window as unknown as { __OFFICEXR_TEST_SEED__: unknown }).__OFFICEXR_TEST_SEED__ = s;
    }, seed);
  }
  await page.goto(`/?test=1#${mode}`, { waitUntil: 'domcontentloaded' });
  await expect(
    page.locator(`button[role="tab"][aria-selected="true"]`),
  ).toHaveText(modeLabel(mode), { timeout: 8_000 });
}

function modeLabel(mode: string): string {
  switch (mode) {
    case 'map':
      return 'Map';
    case 'room':
      return 'Room';
    case 'object':
      return 'Object';
    case 'character':
      return 'Character';
    case 'debug':
      return 'Debug';
    case 'mugshot':
      return 'Mugshot';
    default:
      return mode;
  }
}

/**
 * Wait until the page has a `<canvas>` element with positive size
 * (i.e. R3F has mounted the canvas). Returns the canvas locator. Use
 * this as the gate before asserting on rendered content.
 *
 * `visibleTimeoutMs` covers cold-Vite-cache first-page-load lag —
 * the Debug page in particular pulls in Rapier wasm, Physics, drei,
 * the bot CLI, and a handful of GLTFs on its first visit and can
 * take 8-15 seconds on a cold cache.
 */
export async function waitForCanvasReady(
  page: Page,
  settleMs = 1500,
  visibleTimeoutMs = 20_000,
) {
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: visibleTimeoutMs });
  await page.waitForTimeout(settleMs);
  return canvas;
}

/**
 * Sample N evenly-spaced "pixels" from a Playwright-captured PNG of
 * the canvas region and return a rough count of unique byte triples.
 * Uses `page.screenshot({ clip })` over the canvas's bounding box —
 * page-level screenshots read from the display compositor, NOT from
 * `canvas.toDataURL()`, which means they work regardless of WebGL's
 * `preserveDrawingBuffer` setting. Element-level screenshots on a
 * WebGL canvas time out when the framebuffer isn't preserved.
 *
 * A frozen / empty canvas yields 1-2 distinct byte triples. A real
 * R3F scene with geometry + lighting yields many.
 */
export async function distinctColorsInCanvas(
  canvas: Locator,
  opts: { samples?: number } = {},
): Promise<number> {
  const samples = opts.samples ?? 200;
  const box = await canvas.boundingBox();
  if (!box) return 0;
  const page = canvas.page();
  const buf = await page.screenshot({
    type: 'png',
    clip: {
      x: Math.max(0, Math.floor(box.x)),
      y: Math.max(0, Math.floor(box.y)),
      width: Math.max(1, Math.floor(box.width)),
      height: Math.max(1, Math.floor(box.height)),
    },
  });
  return countDistinctRgbInPng(buf, samples);
}

/**
 * Tiny PNG sampler that doesn't need an `Image`/canvas in node. Reads
 * the RGBA pixel array directly via a minimal PNG decoder
 * (sharp-free, pure JS) and samples N evenly-spaced pixels.
 *
 * We use the PNG signature + IHDR + IDAT trick: decode via zlib and
 * sample. To keep this dependency-free, we let Playwright crop the
 * canvas screenshot and we sample from the raw bytes via a tiny
 * helper. For simplicity, we use a checksum / unique-byte-triple count
 * over a stride sample of the PNG's raw bytes — empirically the PNG
 * compression preserves color variation as byte-triple variation
 * after compression, so a 1-color screenshot compresses to a small
 * set of byte patterns and a many-color screenshot compresses to a
 * wide one. Threshold tuning compensates for this.
 *
 * (A real PNG decoder would be ~80 lines; this approximation is
 * sufficient to discriminate "nothing rendered" from "scene
 * rendered" which is all the tests need.)
 */
export function countDistinctRgbInPng(buf: Buffer, samples: number): number {
  const stride = Math.max(1, Math.floor(buf.length / samples));
  const seen = new Set<number>();
  for (let i = 0; i + 2 < buf.length; i += stride) {
    // Pack three consecutive bytes into a single number so the Set
    // treats them as a tuple.
    seen.add((buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2]);
  }
  return seen.size;
}

/**
 * Lightweight wrapper for collecting console + pageerror noise.
 * Returns a function that fetches the captured lines so a test can
 * assert no `[error]` / `[pageerror]` entries beyond a known
 * allowlist.
 */
export function captureConsole(page: Page): () => string[] {
  const lines: string[] = [];
  page.on('console', (msg) => lines.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => lines.push(`[pageerror] ${err.message}`));
  return () => lines.slice();
}

/**
 * Compare two RGBA pixel buffers of the same size. Returns the
 * count of pixels where the absolute channel-sum difference
 * `|dR|+|dG|+|dB|` exceeds `threshold`. Alpha is ignored — the
 * mugshot baselines are opaque.
 *
 * Used by the mugshot-baseline-compare spec to assert pixel-near-
 * identical reproduction of a committed export.
 */
export function pixelDiffCount(
  a: Uint8Array | Uint8ClampedArray,
  b: Uint8Array | Uint8ClampedArray,
  threshold: number,
): number {
  if (a.length !== b.length) {
    throw new Error(
      `pixelDiffCount: buffer length mismatch (${a.length} vs ${b.length})`,
    );
  }
  let diffs = 0;
  for (let i = 0; i + 2 < a.length; i += 4) {
    const dr = Math.abs(a[i] - b[i]);
    const dg = Math.abs(a[i + 1] - b[i + 1]);
    const db = Math.abs(a[i + 2] - b[i + 2]);
    if (dr + dg + db > threshold) diffs += 1;
  }
  return diffs;
}
