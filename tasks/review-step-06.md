# Code Review Report — Step 6 (headless mode + programmatic bake)

Commit: `6e144d9 feat(studio,world): headless mode + programmatic bake`
Plan: `/Users/raven/.claude/plans/partitioned-launching-moore.md`

## Summary

Ship-ready. The commit faithfully implements the Step 6 design: the
headless harness mounts inside the same `ApplicationProvider` the
studio UI uses, there is exactly one Playwright bridge global
(`window.officexrApi`), and the bake driver does its work through
`api.bake.measureAll()` rather than DOM scraping. The DI seam is
properly at `App.tsx`. Two minor issues (rAF cleanup, `__officexrBoundsReady`
not cleared on unmount) are worth fixing but do not block the bake
path that's actually exercised today.

## Plan Compliance

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 1 | Headless mounts INSIDE same `ApplicationProvider` as UI | Complete | `App.tsx:48-50` — `<ApplicationProvider>` wraps both branches of the `op` ternary |
| 2 | No parallel ApplicationApi construction for headless | Complete | `App.tsx:30-38` is the sole `createDefaultApi` call. `HeadlessApp` consumes via `useApplication()` |
| 3 | Single global Playwright bridge: `window.officexrApi` | Complete | `HeadlessApp.tsx:21-27` set on mount, deleted on unmount, keyed to `[api]` |
| 4 | Programmatic bake (no clicks, no DOM scraping, no Suspense race) | Complete | `BakeRunner.tsx:34` calls `api.bake.measureAll()`; no React rendering of GLTFs involved |
| 5 | Bake script reads via `page.evaluate` | Complete | `bake-kind-dimensions.ts:110-121` |
| 6 | URL dispatch on `?op=bake` / `?op=bounds-scene` | Complete | `App.tsx:43-49`; `HeadlessApp.tsx:29-34` |
| 7 | BoundsScene uses SceneService + ObjectInstances + LightingRig | Complete | `BoundsScene.tsx:32, 97, 119` — no inline `<directionalLight>`, no `BoxGeometry`, no hardcoded dimensions |
| 8 | Future-proof for additional headless ops | Complete | The dispatcher pattern in `HeadlessApp.tsx` is open/closed — add a new op = add a new branch + new component file |
| 9 | Bake catalog PUT preserves untouched fields | Complete | `bake-kind-dimensions.ts:153-161` spreads each kind and only overwrites `dimensions` |
| 10 | Zero-results guard (refuses to overwrite catalog) | Complete | `bake-kind-dimensions.ts:134-137` |

**Compliance Score**: 10/10 requirements fully met.

## Issues Found

### Critical (must fix before shipping)
None.

### Important (should fix)

- **`packages/studio/src/modes/headless/BoundsScene.tsx:62-76`**: The
  rAF cleanup is broken in two ways:
  1. `__officexrBoundsReady` is never reset on unmount — if the same
     page navigates from `?op=bounds-scene` to a different scene
     without a full reload, a stale `true` could mislead the
     Playwright driver into capturing before the new scene paints.
     Mirror the `HeadlessApp` pattern: `return () => { delete
     w.__officexrBoundsReady; }`.
  2. The inner `return () => cancelAnimationFrame(raf2)` (line 73) is
     inside a `requestAnimationFrame` callback, not the `useEffect`
     callback. React ignores it. The outer cleanup only cancels
     `raf1`; if the component unmounts between raf1 firing and raf2
     firing, `setFramePainted(true)` runs on an unmounted component.
     Hoist `raf2` into a ref or `let` declared in the effect scope so
     a single cleanup can cancel whichever is pending.

  Both are latent today because the visual-regression driver script
  doesn't exist yet, but they will bite the first time it does.

### Minor (nice to fix)

- **`packages/studio/src/modes/headless/BakeRunner.tsx:30-33, 76-79`**:
  The `measuring` status sets `done: 0, total: N` and never updates
  `done` — `measureAll()` is opaque. Either drop the progress fields
  (status stays useful as `'measuring' | 'done' | 'error'`) or wire a
  progress callback through `BakeService.measureAll(opts?)`. Current
  UI claims `Measuring 0/N` for the whole run, which is misleading
  if a human ever opens the page.
- **`packages/studio/src/modes/headless/BakeRunner.tsx:9-10`**: Docstring
  says results land on `window.officexrApi.bakeResults`, but the
  actual write is `window.__officexrBakeResults`. Drift between
  comment and code.
- **`packages/world/scripts/bake-kind-dimensions.ts:97-101`**: The
  hardcoded macOS Chrome path is fine as a default but the override
  env var is `PLAYWRIGHT_CHROME_PATH` while Playwright's own convention
  is `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. Minor — but the next
  contributor on Linux/CI will look for the wrong var name.
- **`packages/world/scripts/bake-kind-dimensions.ts:139-148`**: The
  duplicate-dimension sanity check was the prior path's smoke detector
  for the cache race. Now that the work is done through `BakeService`
  one kind at a time, the check is informational at best. Worth a
  comment noting that block-family kinds *should* share `2×2×2` so
  reviewers don't read the warning as a regression signal.
- **`packages/studio/src/modes/headless/HeadlessApp.tsx:22-27`**: The
  `globalThis` cast pattern (`window as unknown as { officexrApi?: typeof api }`)
  is duplicated across all three headless files. A shared
  `headlessGlobals.ts` with typed accessors would localize the dirty
  cast and document the surface the bridge exposes. Not blocking.

## What Looks Good

- The DI seam is exactly where the plan asked: `App.tsx` constructs
  the single `ApplicationApi`, every mode (including headless)
  consumes via `useApplication()`. No parallel `createDefaultApi`
  inside the headless harness.
- `loadGltf` injection in `App.tsx:32-37` honors DIP — three's
  `GLTFLoader` is wired at the composition root, not imported into
  the application layer.
- `HeadlessApp`'s `useEffect` correctly handles the lifecycle of
  `window.officexrApi`: set on mount, deleted on unmount, dependency
  array keyed to `[api]` so a hot reload that replaces `api` swaps
  cleanly.
- `BoundsScene` composes existing renderer primitives (`LightingRig`,
  `ObjectInstances`) and the SDK store contract — no bespoke
  rendering, no inline lights, no `BoxGeometry`. This is the
  "editor canvases compose primitives" rule from CLAUDE.md applied
  correctly to a test harness.
- `BakeRunner` is genuinely click-free and Suspense-free — it never
  renders a GLTF, it just calls `api.bake.measureAll()` and posts the
  result through a sentinel + result pair. This is exactly the
  failure mode the plan was designed to eliminate.
- The bake script's catalog merge preserves author-edited fields
  (`tilingAxes`, `scale`, etc.) by spreading the existing kind and
  only overwriting `dimensions`. Easy thing to get wrong, got right.
- `?op=bounds-scene` is wired through end-to-end even though the
  Playwright driver doesn't exist yet — the plan called this out as
  intended future-proofing.

## Test Coverage

| Area | Tests Exist | Coverage Notes |
|------|-------------|----------------|
| `BakeService` | Yes | `packages/world/src/app/__tests__/bake-service.test.ts` exercises the measure path with a mock loader |
| `SceneService` | Implicit | Scene shape pinned by integration with `BoundsScene` + plan-level acceptance; no dedicated test file |
| `HeadlessApp` URL dispatch | No | Component is small enough that the cost of a JSDOM test outweighs the value, but a one-line render assertion per `op` would be cheap insurance |
| `BakeRunner` | No | Same as above — measureAll already has unit coverage at the service layer |
| `BoundsScene` | No | Visual-regression suite is the natural test surface; planned for the follow-up step |
| `bake-kind-dimensions.ts` driver | No (manual) | E2E by nature; not a unit-testable surface |

**Test Coverage Assessment**: Appropriate. The measurement logic
(the only thing with real branches) is unit-tested at the service
layer. The headless components are thin wiring that would mostly
test React + URL params.

## Test Execution

| Check | Result | Details |
|-------|--------|---------|
| Test command discovered | Yes (`pnpm --filter @officexr/{world,studio} test`) | From repo conventions and the commit message |
| World tests | Passed (178/178) | Clean run, 3.26s |
| Studio tests | Passed (179/179) | Clean run, 7.11s |
| TDD evidence in implementation notes | N/A | No new task-level TDD notes for this commit; the application-layer tests landed in earlier steps |

**Test Execution Assessment**: Matches the commit's claim of "178
world + 179 studio tests pass". No regressions from the headless
additions. The new files have no dedicated tests but the service
layer they delegate to is covered.

## Recommendations

1. (Important) Fix the `BoundsScene` rAF cleanup and `__officexrBoundsReady`
   teardown before the visual-regression driver script lands —
   easier to do now while the file is fresh than to debug a flaky
   pixel diff later.
2. (Minor) Fix the `BakeRunner` docstring drift (`bakeResults` →
   `__officexrBakeResults`).
3. (Minor) Either implement progress reporting in `measureAll()` or
   drop the `done`/`total` fields from the runner status — current
   state is half-truth.
4. (Minor) Rename `PLAYWRIGHT_CHROME_PATH` to `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`
   (or accept both) to match Playwright's documented env var.
5. (Optional) Extract a `packages/studio/src/modes/headless/globals.ts`
   with typed accessors for the four `window.*` globals the harness
   touches — keeps the dirty `as unknown as` casts in one place and
   documents the bridge surface for future ops.
