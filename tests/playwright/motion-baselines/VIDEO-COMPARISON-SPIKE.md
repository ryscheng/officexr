# Video Comparison Spike — Findings

**Date:** 2026-06-11  
**Investigator:** Task-02 implementation  
**Verdict: PARTIALLY VIABLE (Approach A only) — but the committed regression gate remains numeric + keyframe PNG**

---

## Context

Playwright is configured with `video: 'retain-on-failure'` — WebM recordings are only kept on test failure, not as primary artifacts. The goal of this spike was to determine whether fuzzy/perceptual video comparison could serve as a _committed_ regression gate for the motion scenario tests (tasks 10–12), as an alternative or supplement to the numeric assertion + keyframe PNG approach.

---

## Approach A — ffmpeg Frame Sampling + PNG Diff

### Findings

**ffmpeg availability:**
- macOS dev: confirmed at `/usr/local/bin/ffmpeg` (Homebrew-installed, version 7.0.1).
- GitHub Actions `ubuntu-latest`: ffmpeg is pre-installed at `/usr/bin/ffmpeg` as part of the default tool image. The runner images README (ubuntu 22.04/24.04) lists `ffmpeg` explicitly. The CI workflow (`ci.yml`) uses `ubuntu-latest` and does not install ffmpeg separately — it is already present.

**Mechanism:** Spawn `ffmpeg -i <video.webm> -vf fps=N -frames:v K frame_%04d.png -y` to extract K evenly-spaced keyframes as PNG files. Compare extracted PNGs against committed ideal PNGs using pixel-level diff (existing `pngjs` in devDeps) or SSIM.

**Dependencies needed beyond existing devDeps:**
- `pngjs` — already in `package.json` devDependencies (`^7.0.0`). Sufficient for pixel diff.
- `ssim.js` (`^3.5.0`, MIT, ~355 kB unpacked) — optional, adds perceptual SSIM score. Not strictly required if pixel-diff with a threshold is acceptable.
- No new native binaries: ffmpeg is already present on both platforms.

**Overhead estimate:** ffmpeg startup is ~50–100 ms; extracting 3 frames from a short WebM is ~100–300 ms total. Per-frame PNG diff in pngjs is ~5–20 ms. Total per-scenario overhead: under 500 ms. Meets the < 1 s criterion.

**Proof-of-concept command:**
```bash
ffmpeg -i actual.webm -vf "select='eq(n\,0)+eq(n\,30)+eq(n\,60)'" -vsync 0 frame_%04d.png -y
# Or uniformly spaced: -vf fps=0.5 to get one frame every 2 seconds
```

**License:** ffmpeg is LGPL/GPL depending on build flags. The Homebrew macOS build enables GPL codecs; the Ubuntu runner ffmpeg is typically also GPL-licensed. Using ffmpeg as an **external process** (subprocess spawn) does not affect this project's license — only linking the library would. This is the standard pattern for projects that invoke ffmpeg via CLI.

**Maintenance:** ffmpeg is actively maintained (v7.x as of 2024). The CLI interface for frame extraction has been stable for years.

**Verdict for Approach A:** VIABLE as a supplementary failure-analysis tool. See the "Why Not as the Primary Gate" section below.

---

## Approach B — Pure-JS WebM Demuxer + Canvas SSIM

### Findings

**Package investigated: `ts-ebml` (v3.0.2, MIT, ~2.4 MB unpacked)**
- `ts-ebml` parses the WebM/Matroska EBML container structure. It exposes parsed EBML element trees, cluster blocks, and raw codec packet bytes.
- **Critical limitation:** `ts-ebml` does NOT decode video frames. It surfaces raw VP8/VP9 bitstream packets. Getting pixel data (RGBA) from those packets requires a VP8 or VP9 decoder.
- There is no actively maintained pure-JS VP8 or VP9 decoder in Node.js. The historical `ogv.js` project exists but is a complex WASM build targeting browsers; it does not support Node.js environments. The `broadway` package in npm (v4.1.0) is described as "Lightweight App extensibility and hookable middleware customization" — it is NOT the VP8 Broadway decoder (the VP8 decoder project has the same name but a different npm identity and is not published on npm in a usable Node form).

**Package investigated: `yuv-canvas` (v1.3.0, MIT)**
- Converts YUV frame buffers to HTML5 canvas. Browser-only — requires a DOM `<canvas>` element. Not usable in Node.js without `canvas` (native module).

**Package investigated: `canvas` (v3.2.3, MIT)**
- The `node-canvas` package provides a Cairo-backed Canvas implementation for Node. It is a native module (requires compiling or prebuilt binaries for each platform). Pre-built binaries exist for common platforms but add a ~20 MB native dependency to CI.
- Even with `node-canvas`, you would still need to pair it with a VP8/VP9 decoder to get pixel data from the raw EBML blocks. No viable candidate exists.

**Verdict for Approach B:** NOT VIABLE. The chain `ts-ebml → raw VP8/VP9 blocks → decoded RGBA pixels` has no pure-JS solution. The missing link is a VP8/VP9 software decoder that runs in Node. Adding `canvas` (native) plus a hypothetical decoder would add substantial binary dependencies and maintenance burden, violating the feasibility criteria (no unconditional heavy native binary dep).

---

## Approach C — Playwright Native / `playwright-video`

### Findings

**Playwright 1.60 `page.video()` API:**
- Returns a `Video` object with exactly one method: `.path()` which gives the full path to the `.webm` file after the test completes.
- No built-in frame extraction, frame seeking, or SSIM utilities.
- The Playwright team has explicitly declined to add frame-level video access to the core API (as of Playwright 1.x).

**`playwright-video` npm package:**
- A third-party package that records Playwright sessions to video. Not the same as inspecting an existing recording.
- Does not expose frame-level pixel access.

**Playwright's own screenshot mechanism:**
- `page.screenshot()` and `toHaveScreenshot()` are synchronous-to-the-test-execution (they capture the live DOM at a moment in time, not a recorded video).
- This IS the mechanism used by the keyframe PNG approach (tasks 10–12 will call `await page.screenshot()` at predetermined moments in the scenario execution).

**Verdict for Approach C:** NOT VIABLE for frame extraction from recorded video. The Playwright `page.screenshot()` API is the correct mechanism for the committed keyframe PNG gate — but that requires the test to be live, not post-processing a recording.

---

## Why Not Video Comparison as the Primary Regression Gate

Even though Approach A (ffmpeg) is technically viable as a utility, using video comparison as the **primary** regression gate introduces problems that outweigh the benefits:

1. **Videos are only retained on failure** (`video: 'retain-on-failure'`). There are no videos on green runs — so a video-based gate cannot be the committed regression signal. You'd need to change Playwright config to always record video, which adds ~100–400 MB/run of video artifacts and CI storage cost.

2. **No committed baseline video to diff against.** The task spec explicitly prohibits committing binary comparison files. A committed ideal `.webm` would be a large binary with a codec-dependent encoding that produces different pixel values on different machines/ffmpeg versions.

3. **Temporal alignment is fragile.** Even if you had two WebMs of the same scenario, the frame timestamps depend on the frame rate of the virtual machine rendering the 3D scene. Under CI load, the render rate may vary significantly, making frame-N in the actual recording not correspond to the same game-time moment as frame-N in the ideal.

4. **The keyframe PNG approach solves the problem better.** The test harness (tasks 10–12) will call `page.screenshot()` at semantically meaningful moments in the test execution (after settle, after walk detects, after respawn confirms). These are already gated by numeric assertions. The PNG captures the exact frame at that logical moment — no temporal alignment issue. `toHaveScreenshot()` with `maxDiffPixels` tolerance handles minor rendering variance.

---

## Committed Path

The committed regression gate for motion scenario specs (tasks 10–12) is:

1. **Numeric assertions** on `pos`, `vel` (from `__OFFICE_STORE__`) at scenario key moments — using `waitForFunction` pattern from `debug-character-grounded.spec.ts`.
2. **Keyframe PNGs** captured via `page.screenshot()` at those same moments, compared against committed ideals in `motion-baselines/<scenario>/ideal/` via Playwright's `toHaveScreenshot()` or manual `pixelDiffCount()` from `helpers.ts`.

This is explicit confirmation: **numeric + keyframe PNG (Playwright `toHaveScreenshot`) is the committed regression gate for all motion scenario specs.**

---

## Supplementary Utility (Approach A, Optional)

A `video-compare.ts` utility based on ffmpeg IS provided (see `tests/playwright/lib/video-compare.ts`). Its intended use is:

- **Failure-investigation aid only.** When a scenario test fails in CI, the retained WebM can be compared frame-by-frame against a locally-recorded reference to understand WHAT changed visually, not as a pass/fail gate.
- It is NOT wired into any test assertion. Tests remain gated on numeric + PNG.
- It requires ffmpeg to be present (guaranteed on ubuntu-latest and macOS dev). If ffmpeg is absent, the function throws with a clear message.

The utility is provided to fulfill the task requirement for a proof-of-concept when a viable approach exists, and because it is genuinely useful for failure triage.

---

## Summary Table

| Approach | Viable? | Reason |
|---|---|---|
| A — ffmpeg frame sampling | Viable as supplementary tool | ffmpeg on both platforms, no new deps beyond existing pngjs, < 500 ms overhead |
| B — JS WebM demuxer + canvas SSIM | NOT viable | ts-ebml gives raw VP8/VP9 packets; no pure-JS VP8/VP9 decoder exists for Node |
| C — Playwright native frame API | NOT viable | `page.video()` gives file path only; no frame-level access in Playwright 1.x |
| Committed gate | **numeric + keyframe PNG** | Semantically accurate, no binary baseline files, works on every CI run |
