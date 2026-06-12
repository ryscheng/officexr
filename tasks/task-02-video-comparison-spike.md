# Task 02: Video Comparison Spike

## Objective
Investigate whether fuzzy/perceptual video comparison is viable as a regression gate for the motion scenario tests. Produce a written finding and, if viable, a proof-of-concept utility. The numeric+keyframe PNG fallback is always delivered regardless of the spike outcome.

## Context

**Quick Context:**
- Playwright config records video only on test failure (`video: 'retain-on-failure'`) — not as a primary artifact.
- `page.video().path()` can save a WebM after a test completes.
- The mugshot suite uses `toHaveScreenshot()` (PNG pixel diff) for static keyframes — that pattern is the committed fallback.
- The motion scenario specs need a COMMITTED regression gate, not just failure artifacts.

## Requirements

### 1. Investigation scope
Evaluate at least the following approaches for comparing two video sequences:

**Approach A — ffmpeg frame sampling + PNG diff**
- Extract keyframes from WebM using ffmpeg (if available on CI) or a JS/WASM demuxer
- Per-keyframe SSIM or perceptual hash (pHash)
- Tolerance: configurable threshold rather than pixel-exact
- Feasibility check: does ffmpeg exist on the GitHub Actions Linux runners used by this repo? (check `.github/workflows/` if present)

**Approach B — JS WebM demuxer + canvas SSIM**
- Use a pure-JS WebM/VP8/VP9 demuxer (e.g. `ts-ebml`, `webm-byte-stream`, or similar) to extract frames without ffmpeg
- Compute SSIM on canvas ImageData in Node
- Feasibility check: package size, license, maintenance status

**Approach C — Playwright video → frame extraction via `playwright-video` or native APIs**
- Check if Playwright's test runner or any first-party extension exposes frame-level access
- As of Playwright 1.x: `page.video()` only gives the full WebM path — no built-in frame extraction

### 2. Feasibility criteria
A viable approach must:
- Work on macOS dev + Linux CI without an unconditional heavy native binary dep
- Not require committing binary comparison files (only PNG or JSON thresholds)
- Add < 1 s overhead per keyframe comparison in CI
- Be maintainable without deep video-codec expertise

### 3. Written finding (REQUIRED deliverable regardless of outcome)
Create `tests/playwright/motion-baselines/VIDEO-COMPARISON-SPIKE.md` documenting:
- Each approach evaluated, with concrete findings (dependency name, bundle size, CI availability, sample code snippet)
- Verdict: viable / not viable, with rationale
- If viable: the proposed API shape for the utility (`tests/playwright/lib/video-compare.ts` or similar)
- If not viable: explicit confirmation that the numeric + keyframe PNG path is the committed gate

### 4. Proof-of-concept (if viable)
If at least one approach is viable: implement a minimal `tests/playwright/lib/video-compare.ts`:
```ts
/**
 * Compare two video recordings by extracting N keyframes from each and
 * computing per-frame perceptual distance. Returns true if all frames
 * are within `tolerance`.
 */
export async function compareVideoKeyframes(
  actualPath: string,
  idealPath: string,
  options?: { frameCount?: number; tolerance?: number }
): Promise<{ passed: boolean; details: string[] }>;
```
Include at least one test demonstrating the utility works with a known pair of video files.

### 5. Committed fallback (always delivered)
Create `tests/playwright/motion-baselines/` directory structure with empty `manifest.json` stubs for each scenario. The scenario Playwright specs (tasks 10–12) will populate real keyframe PNGs and flesh out the manifests. The directory must exist so tasks 10–12 can reference it.

Stub structure:
```
tests/playwright/motion-baselines/
  scenario-corridor/
    manifest.json   { "scenario": "corridor", "keyframes": [], "assertionThresholds": {} }
  scenario-collision/
    manifest.json   { "scenario": "collision", "keyframes": [], "assertionThresholds": {} }
  scenario-stairs/
    manifest.json   { "scenario": "stairs", "keyframes": [], "assertionThresholds": {} }
  VIDEO-COMPARISON-SPIKE.md
```

## Implementation Details
- TDD does not apply to investigation spikes or asset directory creation. This is research + scaffolding.
- If evaluating ffmpeg: check `.github/workflows/*.yml` for existing CI environment setup; `which ffmpeg` in a GitHub Actions `ubuntu-latest` runner is typically available at `/usr/bin/ffmpeg`.
- The finding doc must be concrete — not "it might work" but "we tried X, here is the output, here is why it does/doesn't meet the criteria."
- Do not install packages without verifying license and maintenance status.

## Acceptance Criteria
- [ ] `tests/playwright/motion-baselines/VIDEO-COMPARISON-SPIKE.md` exists and contains concrete findings for at least two approaches
- [ ] Spike clearly concludes: viable (with chosen approach) OR not viable (fallback confirmed)
- [ ] If viable: `tests/playwright/lib/video-compare.ts` exists with the specified API shape and at least one passing test
- [ ] If not viable: explicit statement in the doc that numeric+keyframe PNG (Playwright `toHaveScreenshot`) is the committed gate
- [ ] `tests/playwright/motion-baselines/` directory exists with per-scenario subdirs and stub `manifest.json` files
- [ ] No new package dependencies added without explicit rationale in the spike doc

## Dependencies
- Depends on: None
- Blocks: task-09 (motion-baseline harness) depends on this directory scaffold; tasks 10–12 (scenario specs) depend on the video comparison decision
