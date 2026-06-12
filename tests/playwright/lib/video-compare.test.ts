/**
 * Tests for the video-compare utility (Approach A from the video-comparison spike).
 *
 * These tests use ffmpeg's lavfi color source to synthesize minimal WebM files
 * (solid-color, 64x64, 2 s, 10 fps) without requiring actual Playwright recordings.
 * Tests skip automatically if ffmpeg is not on PATH.
 *
 * The test file lives under tests/playwright/lib/ and is intentionally NOT a
 * Playwright spec (no `page` fixture) — it exercises the utility's Node.js
 * logic directly via the @playwright/test runner's `test` harness, which
 * supports plain assertion tests without a browser.
 */

import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { compareVideoKeyframes } from './video-compare.ts';

const execFileAsync = promisify(execFile);

/** Returns true if ffmpeg is on PATH. Used to skip tests gracefully. */
async function ffmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a synthetic solid-color WebM using ffmpeg's lavfi source.
 * @param color  CSS color name recognised by ffmpeg (e.g. 'blue', 'red').
 * @param outPath  Destination file path (must end in .webm).
 */
async function makeSyntheticWebM(color: string, outPath: string): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-f', 'lavfi',
    '-i', `color=c=${color}:s=64x64:r=10`,
    '-t', '2',
    '-c:v', 'libvpx-vp9',
    outPath,
    '-y',
  ]);
}

test.describe('video-compare utility', () => {
  let tmpDir: string;

  test.beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vc-test-'));
  });

  test.afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  test('compareVideoKeyframes: identical videos pass within default tolerance', async () => {
    if (!(await ffmpegAvailable())) {
      test.skip(true, 'ffmpeg not on PATH — skipping video-compare test');
      return;
    }

    const blueA = path.join(tmpDir, 'blue-a.webm');
    const blueB = path.join(tmpDir, 'blue-b.webm');
    await makeSyntheticWebM('blue', blueA);
    await makeSyntheticWebM('blue', blueB);

    const result = await compareVideoKeyframes(blueA, blueB, {
      frameCount: 3,
      tolerance: 0.05,
    });

    expect(result.passed).toBe(true);
    expect(result.details.length).toBeGreaterThan(0);
    // All detail lines should indicate OK or skipped (not FAIL)
    for (const line of result.details) {
      expect(line).not.toContain('FAIL');
    }
  });

  test('compareVideoKeyframes: visually different videos exceed tolerance', async () => {
    if (!(await ffmpegAvailable())) {
      test.skip(true, 'ffmpeg not on PATH — skipping video-compare test');
      return;
    }

    const blue = path.join(tmpDir, 'blue.webm');
    const red = path.join(tmpDir, 'red.webm');
    await makeSyntheticWebM('blue', blue);
    await makeSyntheticWebM('red', red);

    const result = await compareVideoKeyframes(blue, red, {
      frameCount: 3,
      tolerance: 0.01, // tight: a fully red vs fully blue 64x64 frame will exceed this
    });

    expect(result.passed).toBe(false);
    // At least one detail line should mention FAIL
    const failLines = result.details.filter((l) => l.includes('FAIL'));
    expect(failLines.length).toBeGreaterThan(0);
  });

  test('compareVideoKeyframes: passes when tolerance is set to 1.0 (all pixels allowed to differ)', async () => {
    if (!(await ffmpegAvailable())) {
      test.skip(true, 'ffmpeg not on PATH — skipping video-compare test');
      return;
    }

    const blue = path.join(tmpDir, 'blue.webm');
    const red = path.join(tmpDir, 'red.webm');
    await makeSyntheticWebM('blue', blue);
    await makeSyntheticWebM('red', red);

    const result = await compareVideoKeyframes(blue, red, {
      frameCount: 3,
      tolerance: 1.0, // allow 100% pixel diff — everything should pass
    });

    expect(result.passed).toBe(true);
    for (const line of result.details) {
      expect(line).not.toContain('FAIL');
    }
  });

  test('compareVideoKeyframes: throws descriptive error when actual file does not exist', async () => {
    if (!(await ffmpegAvailable())) {
      test.skip(true, 'ffmpeg not on PATH — skipping video-compare test');
      return;
    }

    const blue = path.join(tmpDir, 'blue.webm');
    await makeSyntheticWebM('blue', blue);

    await expect(
      compareVideoKeyframes(path.join(tmpDir, 'nonexistent.webm'), blue, { frameCount: 1 }),
    ).rejects.toThrow();
  });
});
