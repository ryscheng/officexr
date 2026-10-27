/**
 * video-compare.ts — Supplementary video comparison utility (Approach A from spike).
 *
 * IMPORTANT: This utility is a FAILURE-INVESTIGATION AID, not the committed regression gate.
 * The committed gate for motion scenario specs is numeric assertions + keyframe PNGs via
 * Playwright's toHaveScreenshot(). See VIDEO-COMPARISON-SPIKE.md for rationale.
 *
 * Mechanism: spawn ffmpeg to extract N evenly-spaced frames from each WebM as PNGs,
 * then compare per-frame pixel difference using pngjs (already a devDependency).
 * Requires ffmpeg on PATH (guaranteed on ubuntu-latest CI runners and typical macOS dev).
 *
 * Usage: called from a test's failure-investigation helper, never from a passing-gate assertion.
 */

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { PNG } from 'pngjs';

const execFileAsync = promisify(execFile);

export interface VideoCompareOptions {
  /** Number of frames to extract and compare. Default: 5. */
  frameCount?: number;
  /**
   * Maximum fraction of pixels allowed to differ between corresponding frames.
   * Range [0, 1]. Default: 0.05 (5% of pixels).
   */
  tolerance?: number;
  /**
   * Per-channel absolute difference threshold below which a pixel is considered
   * "same" (sum of |dR|+|dG|+|dB| must exceed this to count as differing).
   * Default: 30.
   */
  pixelThreshold?: number;
}

export interface VideoCompareResult {
  passed: boolean;
  details: string[];
}

/**
 * Compare two video recordings by extracting N keyframes from each and
 * computing per-frame perceptual distance. Returns true if all frames
 * are within `tolerance`.
 *
 * @param actualPath   Path to the actual WebM recording (e.g. from page.video().path()).
 * @param idealPath    Path to the reference/ideal WebM recording.
 * @param options      Tuning options (frameCount, tolerance, pixelThreshold).
 */
export async function compareVideoKeyframes(
  actualPath: string,
  idealPath: string,
  options?: VideoCompareOptions,
): Promise<VideoCompareResult> {
  const frameCount = options?.frameCount ?? 5;
  const tolerance = options?.tolerance ?? 0.05;
  const pixelThreshold = options?.pixelThreshold ?? 30;

  // Verify ffmpeg is available.
  await assertFfmpegAvailable();

  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'video-compare-'));
  try {
    const actualDir = path.join(tmpDir, 'actual');
    const idealDir = path.join(tmpDir, 'ideal');
    await fs.promises.mkdir(actualDir);
    await fs.promises.mkdir(idealDir);

    // Extract frames from both videos in parallel.
    await Promise.all([
      extractFrames(actualPath, actualDir, frameCount),
      extractFrames(idealPath, idealDir, frameCount),
    ]);

    const details: string[] = [];
    let passed = true;

    for (let i = 1; i <= frameCount; i++) {
      const frameName = `frame_${String(i).padStart(4, '0')}.png`;
      const actualFramePath = path.join(actualDir, frameName);
      const idealFramePath = path.join(idealDir, frameName);

      const actualExists = fs.existsSync(actualFramePath);
      const idealExists = fs.existsSync(idealFramePath);

      if (!actualExists || !idealExists) {
        // Video may be shorter than frameCount — skip missing trailing frames.
        details.push(
          `Frame ${i}: skipped (actual=${actualExists}, ideal=${idealExists}) — video may be shorter than frameCount`,
        );
        continue;
      }

      const actualPng = await loadPng(actualFramePath);
      const idealPng = await loadPng(idealFramePath);

      if (actualPng.width !== idealPng.width || actualPng.height !== idealPng.height) {
        details.push(
          `Frame ${i}: dimension mismatch (actual ${actualPng.width}x${actualPng.height} vs ideal ${idealPng.width}x${idealPng.height}) — FAIL`,
        );
        passed = false;
        continue;
      }

      const totalPixels = actualPng.width * actualPng.height;
      const diffPixels = pixelDiffCount(actualPng.data, idealPng.data, pixelThreshold);
      const diffFraction = diffPixels / totalPixels;

      if (diffFraction > tolerance) {
        details.push(
          `Frame ${i}: ${diffPixels}/${totalPixels} pixels differ (${(diffFraction * 100).toFixed(1)}% > tolerance ${(tolerance * 100).toFixed(1)}%) — FAIL`,
        );
        passed = false;
      } else {
        details.push(
          `Frame ${i}: ${diffPixels}/${totalPixels} pixels differ (${(diffFraction * 100).toFixed(1)}%) — OK`,
        );
      }
    }

    return { passed, details };
  } finally {
    // Clean up temp dir.
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Extract `frameCount` evenly-spaced frames from a WebM file into `outDir`
 * as PNG files named frame_0001.png, frame_0002.png, etc.
 *
 * Uses ffmpeg's `fps` filter to sample at a uniform rate computed from the
 * video duration, then limits output to `frameCount` frames.
 */
async function extractFrames(
  videoPath: string,
  outDir: string,
  frameCount: number,
): Promise<void> {
  // Get video duration first so we can compute the correct fps to extract exactly frameCount frames.
  // ffprobe is shipped alongside ffmpeg.
  let duration = 10; // default fallback
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ]);
    duration = parseFloat(stdout.trim()) || duration;
  } catch {
    // ffprobe unavailable or parse failed — fall back to a 1 fps extraction rate.
  }

  // fps = frameCount / duration gives exactly frameCount frames over the full duration.
  const fps = frameCount / duration;

  await execFileAsync('ffmpeg', [
    '-i', videoPath,
    '-vf', `fps=${fps.toFixed(6)}`,
    '-frames:v', String(frameCount),
    path.join(outDir, 'frame_%04d.png'),
    '-y',
  ]);
}

/**
 * Assert ffmpeg is available on PATH. Throws a descriptive error if not.
 */
async function assertFfmpegAvailable(): Promise<void> {
  try {
    await execFileAsync('ffmpeg', ['-version']);
  } catch {
    throw new Error(
      'video-compare: ffmpeg is not available on PATH. ' +
      'Install ffmpeg (macOS: brew install ffmpeg; Linux CI: already present on ubuntu-latest runners). ' +
      'If this is running in an environment without ffmpeg, use the numeric + keyframe PNG gate instead.',
    );
  }
}

/**
 * Load a PNG file and return its pixel data.
 */
async function loadPng(filePath: string): Promise<PNG> {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.pipe(
      new PNG().on('parsed', function (this: PNG) {
        resolve(this);
      }),
    ).on('error', reject);
  });
}

/**
 * Count the number of pixels where the absolute channel sum |dR|+|dG|+|dB|
 * exceeds `threshold`. Alpha is ignored.
 * Mirrors the same helper in tests/playwright/helpers.ts (RGBA buffers).
 */
function pixelDiffCount(
  a: Uint8Array | Buffer,
  b: Uint8Array | Buffer,
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
