# Debug map-switch screenshots

Captured by Playwright via `gl.readPixels` against the actual rendered
WebGL framebuffer (Playwright's `page.screenshot` hangs against Debug's
GPU stalls). Three frames in sequence:

1. `1-default.png` — boot loads `default` (platform). Store reports
   625 cube instances at voxel bbox (0..24, 0..24, 0..24). Local
   player at (12, 2, 12) — centre of platform.
2. `2-long_corridor.png` — picker switched to `long_corridor`.
   Store reports 58 instances at voxel bbox (-4..6, …, -2..1).
   Local player teleported to (-7.15, 2, -0.88).
3. `3-default-again.png` — picker switched back to `default`. Store
   reports 625 instances; player back at (12, 2, 12).

The three frames have three different SHA-256 hashes; pixel hash
fingerprints differ (`2905769e…`, `a87a773f…`, `bb271bd7…`).

Reproduce with:

```bash
pnpm test:e2e tests/playwright/debug-mode.spec.ts
```

The "Map switch in Debug actually changes the rendered world" test
asserts both the store delta AND the pixel-hash delta.
