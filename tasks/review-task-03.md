# Review — Task 3 (CubeKind catalog → JSON + ObjectInstances reads from catalog hook)

## Summary

Spec compliance is high. All bullets land: schema, bundled-default + editable JSON, catalog singleton + `useCubeCatalog`, back-compat `CUBE_KINDS` snapshot, renderer subscription, material override application (clone-only-on-override, correct field application, scale multiply). Tests cover schema round-trip, store mutation/subscription, and bootstrap memoization adequately.

One real bug: the matrix-fill `useEffect` will not re-run when the material clone is rebuilt, so live material edits in the Object editor (Task 11) will silently leave a fresh InstancedMesh with stale/empty matrices until something else invalidates the deps. Two adequacy gaps in tests. Otherwise clean.

Build: `pnpm --filter @officexr/world test` 80/80; `typecheck` clean on both world and studio; `pnpm --filter @officexr/studio test` 2/2.

---

### Critical

(none — nothing here blocks the commit)

---

### Important

- **`packages/world/src/renderer/ObjectInstances.tsx:115-136`** — Matrix-fill effect deps are `[instances, cubeSize, kind.scale]`, but the InstancedMesh is reconstructed by R3F whenever the `mat` arg changes (line 144, `args={[geom, mat, capacity]}` triggers reconstruction on `args[1]` identity change). When the Object editor edits `tint`/`opacity`/`roughness`/`metalness`/`emissive`, `mat` re-memoizes → R3F builds a new mesh → `meshRef.current` is a brand-new InstancedMesh with uninitialized matrices → the matrix-fill effect does NOT re-run (none of its listed deps changed). Result: live material edits cause cubes to disappear/scramble visually until an unrelated dep triggers a re-fill. Fix: add `mat` to the effect deps (or avoid the rebuild by passing the material as the JSX `material` prop instead of via `args`, since geometry+material are properties of InstancedMesh, not constructor-only). The acceptance test in the plan (Task 11) — "Edit blue block tint to magenta → render magenta" — will trip this.

- **`packages/world/src/scenes/cube-catalog.test.ts`** — No test exercises `useCubeCatalog` as a React hook. The criterion explicitly asked for "does `useCubeCatalog` subscriber behavior have a test that proves a component re-renders". Current tests only assert the non-React `subscribeCatalog` callback fires (lines 56-68), which proves the store but not the hook wiring. Add a `renderHook` test (vitest already pulls in jsdom; `@testing-library/react` is available — `packages/studio` already uses it) that mounts `useCubeCatalog`, calls `replaceCatalog`, and asserts the returned `kinds` reflect the new value.

- **`packages/world/src/renderer/ObjectInstances.tsx:175-211`** — No test for `buildMaterialForKind` / `hasOverrides`. Criterion 7 called this out specifically ("material-clone-only-on-override behavior tested"). The function is pure (takes a scene + kind, returns a Material) and easy to unit-test with a stub scene; ship a small test that proves (a) returns reference-equal `base` when no overrides, (b) returns a clone with `transparent: true` when opacity < 1, (c) sets `color`/`emissive`/etc. correctly only when the corresponding fields are non-null.

---

### Minor

- **`packages/world/src/scenes/cube-catalog.ts:68-87`** — `bootstrapCatalog` is permanently memoized via `bootstrapPromise`, even on failure. There's no production path to retry a failed bootstrap (only `__resetBootstrapForTests`). Not load-bearing today (the fallback to bundled default is the documented behavior), but worth a one-line comment that this is intentional so a future contributor doesn't add a retry-on-failure thinking it's missing.

- **`packages/world/src/scenes/cube-catalog.ts:102-111`** — `useCubeCatalog` reads `current.kinds` directly at render time rather than using `useSyncExternalStore`. This works (the `force` reducer triggers a re-render which re-reads the module-level mutable), but it bypasses React's tearing protections and the canonical external-store pattern the SDK uses elsewhere. Functionally fine for single-renderer use; flagging in case a future renderer mounts in a Suspense'd / concurrent-rendered subtree.

- **`packages/world/src/scenes/cube-catalog.ts:104`** — `useEffect(() => subscribeCatalog(force), [])` will trigger an exhaustive-deps lint warning. `force` (from `useReducer`) is stable per React's guarantees, but if the project lint config enforces `react-hooks/exhaustive-deps` an explicit `// eslint-disable-next-line` plus a one-line note is cleaner.

- **`packages/world/src/scenes/cube-kinds-schema.ts:99-100`** — `updatedAt` falls back to `Date.now()` when the field is missing. That's a hidden side effect inside a validator (calling it twice on the same input produces non-equal results), which complicates testing. Either require `updatedAt` or default to `0`. Round-trip tests pass because the test inputs always include `updatedAt`, but the silent now-coercion bites the next person who writes a validator test.

- **`packages/world/src/scenes/cube-kinds-schema.ts:122`** — `Boolean(k.walkable ?? false)` is a degenerate expression — `??` already replaces only nullish, then `Boolean` coerces. A literal `true`/`false` works, but `Boolean('false')` (string) → `true`. Not a real bug because the JSON loader never produces string `'false'`, but the spec was "validator coerces missing fields to documented defaults"; this one quietly coerces non-boolean truthy values. Minor.

- **`packages/world/cube-kinds.json`** vs **`cube-kinds.default.json`** — identical byte-for-byte (verified via `diff`). Fine for the seed, but the spec is silent on whether the editable file should be in git going forward. If the Object editor will overwrite it via `FilesystemCatalogStorage` (Task 11), it'll churn diffs forever. Worth a `.gitignore` entry for `cube-kinds.json` (keeping `cube-kinds.default.json` versioned) — flag for Task 11.

- **`packages/world/src/scenes/cube-kinds.ts:38`** — `CUBE_KINDS` is a snapshot of `listKinds()` at module load, which in turn reads `current.kinds` from the catalog. Because `listKinds` returns `current.kinds` by reference (not a copy — see `cube-catalog.ts:38`), if any code path mutated that array in place, the snapshot would mutate too. Today nothing does — `replaceCatalog` always assigns a new `current` — but a defensive `Object.freeze(current.kinds)` in `replaceCatalog` (and on the initial validate) would lock the contract in.

- **`packages/world/src/scenes/cube-kinds.ts:38`** comment block (lines 9-15) — Documents the snapshot choice well. Criterion 9 was "confirm the choice is intentional and documented" — it is. Carry forward to Task 6 (selection of consumers to migrate to `useCubeCatalog()`).

---

## What looks good

- DIP holds: `cube-catalog.ts` and `cube-kinds-schema.ts` import zero `three`. Verified with `grep "from 'three'" packages/world/src/scenes/cube-*.ts` → empty. React is allowed in `@officexr/world`.
- `import * as THREE` stays confined to `renderer/` — `ObjectInstances.tsx` is the only file in this diff that touches three.
- Material override application is faithful to the spec: clone-only-when-needed (line 180), per-field guards prevent overwriting GLTF defaults when override is null (lines 183-199), `transparent: true` flips only on `opacity < 1` (line 186-189), emissive intensity is paired with emissive color so a null emissive doesn't leak intensity.
- `SEAM_OVERLAP = 1.05` is preserved as a renderer-side constant, decoupled from `kind.scale` (1 = no change). This is a cleaner separation than the spec literally asked for (the spec said "multiply instance scale by `kind.scale` (replaces hardcoded 1.05)") — the implementer reasoned that the seam-fix is a renderer concern, not a per-kind authoring concern. Documented at lines 82-86. Good call.
- Bootstrap idempotency via `bootstrapPromise` is the right pattern; concurrent first-renders (e.g. multiple `<ObjectInstances>` mounts) all observe the same in-flight fetch.
- Schema validator throws on unrecoverable inputs (wrong schemaVersion, missing required string fields, non-array `kinds`) but soft-fails (coerce-to-default) on optional override fields. That's the correct asymmetry for an authoring file users may hand-edit.
- 13 tests in `cube-catalog.test.ts` cover: bundled-default hydration, replace + subscribe lifecycle, unsubscribe, missing-id lookup, fetch-success replace, fetch-fail fallback, memoization, full-entry round-trip, defaults coercion, schema-version rejection, required-field rejection, non-array kinds, invalid-category coercion. Good breadth.
- `__resetBootstrapForTests` is clearly labeled test-only at lines 89-91 and only called from the test file.

## PRD Compliance

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 1 | `CubeKindEntry` / `CubeKindCatalogV1` schema with extended fields | ✅ | `cube-kinds-schema.ts:33-67`. All eight extension fields present. |
| 2 | Move `CUBE_KINDS` to `cube-kinds.json` + ship `cube-kinds.default.json` | ✅ | Both files present, 12 kinds, identical content. |
| 3 | `cube-catalog.ts` singleton: `getCatalog` / `listKinds` / `subscribeCatalog` / `replaceCatalog` | ✅ | Lines 33-55. Plus `getKind`, `resetCatalogToDefault`, `bootstrapCatalog`, `useCubeCatalog`. |
| 4 | Bootstrap via `fetch('/api/cube-kinds')` with bundled-default fallback | ✅ | Lines 68-87. Fallback warns + keeps default in place. |
| 5 | Expose `useCubeCatalog()` React hook | ✅ | Lines 102-111. Reactivity not test-verified — see Important #2. |
| 6 | `cube-kinds.ts` re-exports `CUBE_KINDS` as a back-compat facade | ✅ | `cube-kinds.ts:38`. Snapshot semantics clearly documented. |
| 7 | `ObjectInstances.tsx`: clone material per kind, apply overrides, multiply by `kind.scale` | ⚠️ | Field application correct; clone-on-override correct; matrix effect has a missed dep on `mat` → see Important #1. |
| 8 | Test: catalog round-trip | ✅ | `cube-catalog.test.ts:131-145`. |
| 9 | Test: subscriber fires on replace | ✅ | Lines 56-68 (store level). React-hook level: missing — see Important #2. |
| 10 | Test: material-override fields survive round-trip | ✅ | Lines 131-145 covers the JSON round-trip; no test for the renderer-side `buildMaterialForKind` — see Important #3. |
| 11 | Acceptance: Debug renders default scene visually identical | ✅ | `kind.scale = 1` × `SEAM_OVERLAP = 1.05` = same final scale; no-override path returns reference-equal material. Reasoning-verified, not manually smoke-tested in this review. |
| 12 | Acceptance: edit blue tint → magenta render | ⚠️ | Will visually break the first edit due to Important #1 (matrix effect doesn't re-fire when material rebuilds). After page reload it'd render correctly because the rebuild happens during initial mount; the bug only surfaces on live edits. |

**Compliance Score**: 10/12 fully met; 2 partial (#7, #12) due to a single bug.

## Test Execution

| Check | Result | Details |
|-------|--------|---------|
| `pnpm --filter @officexr/world test` | 80/80 pass | All catalog tests green. |
| `pnpm --filter @officexr/world typecheck` | clean | |
| `pnpm --filter @officexr/studio test` | 2/2 pass | |
| `pnpm --filter @officexr/studio typecheck` | clean | |

## Recommendations (ordered)

1. Fix Important #1 (matrix effect deps) before Task 11 ships, ideally now — it's a one-line change and the Task 11 acceptance criteria depends on it.
2. Add the two missing tests (Important #2, #3) — both are small, both are explicitly named in the review criteria.
3. Drop a one-line `gitignore` entry consideration into Task 11's plan for the editable `cube-kinds.json`.
4. Minor cleanups (validator side effects, lint, freeze) at author's discretion.
