# Code Review — Step 2: ApplicationProvider + DI-friendly hooks

**Commit:** `c92cbb8 feat(world/react,studio): ApplicationProvider + DI-friendly hooks`
**Reviewed against:** `/Users/raven/.claude/plans/partitioned-launching-moore.md`

## Verdict

**fix-first** — one correctness bug in `useInstanceAABB` will silently
return stale AABBs after live Object-editor kind edits. Otherwise the
wiring is clean, narrow, and faithful to the plan. A ~10-line fix
unblocks ship.

**Architecture-alignment grade:** 88% — DI boundary is crisp, no
module-globals, no `window`. The one memo-deps mismatch and a couple
of subscription patterns that should use `useSyncExternalStore` cost
the rest.

---

## Summary

This commit is exactly the scope the plan calls for: a React context
that exposes `ApplicationApi`, four derived hooks, an `./react`
subpath export from `@officexr/world`, and the single studio entry
point (`App.tsx`) that constructs the concrete API. No call sites are
migrated yet — Step 3+ does that. Tests stay green (178 world, 174
studio). The only issues are localised to the new file.

---

## PRD / Plan Compliance

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | `ApplicationContext` + `<ApplicationProvider>` at `packages/world/src/react/application-context.tsx` | Complete | Matches plan signature 1:1. |
| 2 | `useApplication()` throws when no provider | Complete | Error message names the fix ("Wrap your app root"). Plan explicitly specified throw. |
| 3 | `useCatalog()` — live list, subscribes | Complete | Uses standard subscribe + force-render pattern. |
| 4 | `useCatalogReady()` — gates compile-time consumers | Complete | Cancellation guard on unmount. |
| 5 | `useKind(id)` — single-kind lookup with subscription | Complete | Hook-order safe (effect registered before early return on `!id`). |
| 6 | `useInstanceAABB()` — memoised world-AABB, recomputes on live dim edits | **Partial** | See **Critical** below. The memo-deps don't include catalog state. |
| 7 | `@officexr/world/react` subpath export | Complete | `package.json` `exports["./react"]` correctly added. |
| 8 | `<ApplicationProvider api={createDefaultApi(...)}>` wraps the studio | Complete | `App.tsx → ApplicationProvider → StudioPage` — nothing renders outside it. |
| 9 | `loadGltf` injected for `BakeService`, shares the network cache with `useGLTF` | Mostly complete | Loader classes differ (see Important #1); HTTP cache is shared (correct claim). |
| 10 | No module-level singletons or `window` writes introduced | Complete | `grep -rn "window\." packages/world/src/react packages/world/src/app packages/studio/src/App.tsx` returns zero. |
| 11 | App.tsx is the only studio file that knows the concrete factories | Complete | `grep createDefaultApi packages/studio/src` returns only `App.tsx`. |
| 12 | Existing module-globals (`getKind`, `getKindStride`, `useObjectKindCatalog`, old `useCatalogReady`) still work as deprecated shims | Complete | All prior call sites compile + run unchanged. |
| 13 | SOLID-DIP grep stays clean for sdk / realtime-server / core-refactor | Complete | `grep -rn "from 'three'"` and `from 'react'` in those three packages return zero. |

**Score:** 12 of 13 fully met; #6 is partial.

---

## Issues Found

### Critical

- **`packages/world/src/react/application-context.tsx:107-117`** —
  `useInstanceAABB` does not recompute its AABB when the catalog
  emits, even though its doc-comment claims it does. The effect
  subscribes and the `force` reducer re-renders the component, but
  the `useMemo` deps are `[api.geometry, position[0], position[1],
  position[2], kindId]` — none of those change when
  `CatalogService.patchKind(...)` mutates `kind.dimensions`. The memo
  returns the stale closure result. This breaks the documented use
  case ("recomputes if the kind's dimensions change live in the
  Object editor"). The inline comment "Subscribing forces a recompute;
  deps cover the inputs" is incorrect — subscribing forces a
  re-render, not a memo recompute. Add a version counter to deps (or
  swap to `useSyncExternalStore`, which is the idiomatic primitive
  for this exact case in React 19).

### Important

1. **`packages/studio/src/App.tsx:3,30-36`** — the injected `loadGltf`
   uses `GLTFLoader` from `three/examples/jsm/loaders/GLTFLoader.js`,
   but drei's `useGLTF` uses the `GLTFLoader` from `three-stdlib` and
   wires DRACO + Meshopt extensions when needed (see
   `node_modules/.pnpm/@react-three+drei@*/.../core/Gltf.js`). The
   commit message's "browsers cache the HTTP response" claim is
   correct — the GLB/GLTF bytes won't be re-fetched. But the two
   loaders maintain separate in-memory caches and use different
   extension chains; a future kind that ships as DRACO-compressed
   GLB would parse via drei but fail to parse via the bake loader.
   Two practical mitigations: (a) import `GLTFLoader` from
   `three-stdlib` (same package drei uses) so any future extension
   changes stay in sync, or (b) accept the divergence and document
   the constraint ("bake path requires uncompressed GLTF") at the
   `loadGltf` injection site. Either is fine; current code does
   neither.

2. **`packages/world/src/react/application-context.tsx:65-70, 94-100`**
   — `useCatalog` and `useKind` use the classic
   `useEffect(subscribe)` + `useReducer` force-render pattern. This
   works but is susceptible to torn reads in concurrent rendering
   (Strict Mode double-invokes effects, React 19 can interrupt). The
   project is already on React 19; `useSyncExternalStore` is the
   recommended primitive for subscribing to an external store and
   handles SSR + concurrency correctly out of the box. Same reducer
   pattern was the load-bearing footgun that ARCHITECTURE.md
   observation O3 (referenced in CLAUDE.md) calls out for
   `setStateSync` mirrors — not identical here, but similar shape.

3. **No tests for the new React hooks.** Step-1 has thorough tests in
   `packages/world/src/app/__tests__/`. Step-2's hooks have zero. A
   `react/__tests__/application-context.test.tsx` that (a) asserts
   `useApplication` throws without a provider, (b) asserts
   `useCatalog` re-renders when `patchKind` fires, (c) reproduces
   the Critical bug above (patch a kind's dimensions, expect the
   `useInstanceAABB` consumer to receive new values) would have
   caught the memo-deps mismatch.

### Minor

1. **`packages/world/src/app/bake-service.ts:9`** — `import * as
   THREE from 'three'` in the Application Layer technically violates
   the plan's "No three.js" rule for that layer. The use is
   type-only (`THREE.Object3D`), so it's a documented-decision-grade
   leak rather than a real DIP break. This was introduced in Step 1
   (out of scope for Step 2). Consider replacing with a structural
   `interface Object3DLike { ... }` in a follow-up, or add an
   inline SOLID-violation comment per CLAUDE.md's "document the
   reason" rule.

2. **`packages/world/src/react/application-context.tsx:114`** — the
   `// eslint-disable-next-line react-hooks/exhaustive-deps` suppresses
   the lint for the wrong reason. The comment claims "Subscribing
   forces a recompute; deps cover the inputs," but the lint is
   complaining because `position` is destructured by index, which is
   actually fine in practice. Either remove the suppression by
   spreading the position array properly, or keep the suppression
   but rewrite the justification.

3. **Two `useCatalogReady` exports now exist** —
   `@officexr/world/scenes` exports the old module-global one;
   `@officexr/world/react` exports the new DI one. The plan
   explicitly allows this ("deprecated shims for one release"), so
   it isn't a deviation. But the two have separate internal state
   and will diverge if anything ever calls `replaceCatalog()` on the
   new service without going through the old module-global. Worth a
   `@deprecated` JSDoc on the old export to make IDE pressure
   visible.

4. **No implementation note recorded.** The repo convention (see
   `tasks/implementation-notes.md` for tasks 00–11) is to log a
   short note per non-trivial commit. Step 2 is a deliberate layer
   addition with three SOLID-relevant design decisions (throw vs
   return null, derived-hooks vs raw context, GLTFLoader source) —
   recording the reasoning in `tasks/implementation-notes.md` would
   help the Step 3 implementer.

---

## What Looks Good

- **DIP boundary is exactly where the plan wanted it.** `App.tsx` is
  the only studio file that imports `createDefaultApi`. Everything
  below consumes `ApplicationApi` through the context.
- **Zero `window` writes.** The plan's "one global, but only at the
  Playwright bridge" rule is held; this step doesn't even need the
  bridge.
- **`useApplication` throw is the right call.** Returning `null`
  would have forced every consumer to either assert or null-check,
  and the testing-failures-are-confusing argument in the inline
  comment is the same trade-off this codebase already made for
  `getKindBoundingDimensions` and `useGLTF`. Matches the plan
  verbatim.
- **Hook-order safety in `useKind`.** Effect registered before the
  `!id` early return — would have been an easy bug to introduce.
- **Subscribe cleanup is correct.** `useEffect(() =>
  api.catalog.subscribe(force), [api.catalog])` — the arrow returns
  the unsubscribe function, which React uses as the effect cleanup.
  Idiomatic.
- **`package.json` `exports` map is well-shaped.** Adding `./react`
  alongside `./app`, `./renderer`, etc. keeps the headless surface
  (`./app`) importable from Node-side tooling without dragging in
  React.
- **Stable references.** `api` is `useMemo`'d in `App.tsx` (empty
  deps), so the context value doesn't churn — all the derived hooks'
  `[api.catalog]` and `[api.geometry]` deps remain stable across
  renders.
- **Commit message is accurate** on the no-double-download claim
  (modulo the loader-class divergence noted in Important #1).

---

## Test Coverage

| Area | Tests Exist | Coverage Notes |
|---|---|---|
| `ApplicationProvider` / `useApplication` | **No** | New file, no test file. |
| `useCatalog` / `useKind` re-render on emit | **No** | Would have caught the memo bug. |
| `useCatalogReady` | **No** | Step-1 has `catalog-service.test.ts` for the underlying `ready()`, but the React-side gating is untested. |
| `useInstanceAABB` recompute on patch | **No** | Critical bug above is invisible to the current suite. |
| `loadGltf` injection wired through | Indirect | Step-1 `bake-service.test.ts` injects a mock loader and asserts dims. |
| Existing world / studio behaviour | Pass | 178 + 174 green. |

**Assessment:** the suite gives high confidence the existing studio
still works (nothing has been migrated yet, so it should), but zero
confidence the new layer behaves as documented. Add the three tests
listed in Important #3 before Step 3.

---

## Test Execution

| Check | Result | Details |
|---|---|---|
| Test command discovered | Yes (`pnpm --filter @officexr/world test`, `pnpm --filter @officexr/studio test`) | From each package's `package.json` `scripts.test`. |
| World suite | Passed (178/178) | 2.04s. |
| Studio suite | Passed (174/174) | 3.56s. |
| TDD evidence in implementation-notes | No | No Step-2 entry in `tasks/implementation-notes.md` yet — see Minor #4. |

**Assessment:** suites pass cleanly. They prove nothing about the new
hooks because no test exercises them; that's expected only for the
already-migrated Step-1 code.

---

## Implementation Decision Review

| Task | Decisions Documented | Decisions Sound | Flags |
|---|---|---|---|
| Step 2 wiring | Partially (in commit message + file-level doc comments) | Mostly | `useInstanceAABB` deps choice is wrong; `GLTFLoader` source choice diverges from drei without an inline note. |

**Decision Assessment:** the high-level decisions (throw vs null,
single provider at App root, no `window`) are well-reasoned and the
reasoning is recorded in the commit message and file headers. Two
implementation-level decisions (memo deps; `three/examples` vs
`three-stdlib` GLTFLoader) lack written justification and the first
is wrong.

---

## Recommendations (priority order)

1. **Fix `useInstanceAABB` memo deps** — add a version counter
   incremented in the subscribe callback (or migrate to
   `useSyncExternalStore`). Reproduce the bug in a test first; it's
   a one-line repro: patch a kind's dimensions, expect the AABB to
   change.
2. **Add `packages/world/src/react/__tests__/application-context.test.tsx`**
   with the three scenarios in Important #3.
3. **Decide on `GLTFLoader` source** — either align with drei
   (`three-stdlib`) or document the constraint inline at the
   `App.tsx` injection site. Prefer alignment.
4. **Record a Step-2 entry in `tasks/implementation-notes.md`** —
   the throw-vs-null call, the derived-hooks shape, and the
   loader-source decision are exactly the non-obvious choices the
   notes file exists to capture.
5. (Follow-up, not blocking Step 3.) Consider migrating the existing
   `useCatalog` / `useKind` to `useSyncExternalStore` for
   concurrent-safe subscription. Same change covers Important #2.
6. (Step 1 follow-up.) Replace `import * as THREE from 'three'` in
   `bake-service.ts` with a structural `Object3DLike` interface, or
   add an inline SOLID-violation comment.
