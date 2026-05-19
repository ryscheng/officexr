# Architecture Review — commit 2f0c1e9

**Scope.** Layout authoring mode + baked-GLTF map optimization. Three phases
landed together: (1) Layout document + studio mode + storage routes, (2) bake
service rewired against `InstanceGeometryService`, (3) pluggable
`BakeOptimizer` registry.

**Lens.** Layered architecture compliance (the headless / UI / renderer
three-layer rule), SOLID, abstraction quality, future extensibility. NOT a
functional or test-coverage review.

---

## 1. Headlines

- **Layered separation is rigorously clean for the new code.** All five
  new headless modules (`bake-optimizers.ts`, `bake-registry.ts`,
  `layout-bake-service.ts`, `layout-bake-service-browser.ts`,
  `layout-document.ts`, `localstorage-layout-storage.ts`,
  `filesystem-layout-storage.ts`) contain ZERO imports of `three`, `react`,
  or any DOM API beyond `fetch`. Greps in §2 verify it.

- **The DIP win is real.** `bakeLayout` now consumes
  `InstanceGeometryService.meshOrigin` instead of reimplementing voxel→world
  math. The commit message claims this is the "single source of truth";
  the code backs it up. Headless CLI, registry, and runtime renderer all
  read the same service. This is the textbook example of dependency
  inversion done right.

- **The ISP narrowing of `KindResolver`** (geometry-service.ts:43–45) is
  exactly the right move and the comment documents the reasoning. The CLI
  bake at `scripts/bake-layout.ts:120–124` now constructs `KindResolver`
  inline from a `Map` — no `CatalogService` mocking required. Clean.

- **`BakeOptimizer` interface is reasonable but half-step.** It is
  closed-for-extension by *external packages* (the registry is a
  `ReadonlyMap` baked into `bake-optimizers.ts`). Adding a strategy still
  requires editing the file that defines the registry. Acceptable scope
  boundary; called out in §4.

- **`BakedLayout` vs `BakedLayoutColliders` subscription asymmetry is a
  real LSP/SRP bug.** `BakedLayout` subscribes to the registry and
  cache-busts on settle; `BakedLayoutColliders` only reads the version at
  mount time and never subscribes. After the SECOND bake of a session, the
  visible mesh updates while colliders stay stale. The comment in
  `BakedLayoutColliders.tsx:100–106` rationalises this as "the parent
  re-mounts" — but in `Scene.tsx:221–232` the two are siblings with
  identical props and the parent does NOT re-mount on bake settle. This is
  a behaviour drift between the two implementations of the same
  cache-busting contract.

- **`LayoutApp.roomDocCompat` shim is an ISP code smell properly
  documented.** A 30-field structural cast at `LayoutApp.tsx:245–285`
  papers over `InspectorPanel`'s wide prop. The comment names the
  principle, the why, and the fix-path. Acceptable per CLAUDE.md's
  "doc-the-reason" policy, but the consequence is a visible UX bug: the
  Inspector's `LayoutSection` renders inside the Layout editor showing a
  field that silently does nothing. See §3.

- **`useLayoutDocument` is a clean copy of `useRoomDocument`.** The
  comment at `useLayoutDocument.ts:11–16` explicitly chooses NOT to
  pre-emptively share code — the right call. Two separate doc types with
  divergent histories (no groups, simpler undo) are better served by two
  hooks than one parameterised abstraction.

- **CLI script is well-isolated and would survive a `--noResolve` build.**
  `bake-layout.ts` imports only `node:fs`, `node:path`, `node:url`,
  `@gltf-transform/core`, and three application-layer modules. No
  studio/react/renderer reach-back.

- **`migrateToV5` migration chain is complete and well-tested.** v1 → v2
  → v3 → v4 → v5 chains correctly through `migrateRoomV3toV4` and
  `migrateRoomV4toV5`. All `RoomStorage` consumers updated. Round-trip
  tests at `migration.test.ts:210–257` cover the new path.

- **`optimizer` field has serialization but no migration test coverage.**
  The field is new and optional, so back-compat is trivial — but the
  layout `serializeLayout`/`deserializeLayout` round-trip test at
  `migration.test.ts:259–298` does not exercise `optimizer`. Minor.

- **Schedule-bake debounce race window is well-handled.** The synchronous
  in-flight promise creation in `awaitFresh` (bake-registry.ts:212–264)
  and the post-await re-bake check in `scheduleBake`'s timer
  (bake-registry.ts:173–191) are both correct under JS single-threaded
  reentry. Tests cover both.

---

## 2. Layered architecture violations

Run `grep -rn "from 'three'\|from \"three\"" packages/sdk/src
packages/realtime-server/src packages/core-refactor/src packages/world/src/app
packages/world/src/scenes`:

```
packages/world/src/app/bake-service.ts:12:import type * as THREE from 'three';
packages/world/src/app/__tests__/bake-service.test.ts:2:import * as THREE from 'three';
```

- `packages/world/src/app/bake-service.ts:12` — `import type * as THREE
  from 'three'` is a **type-only** import. Since TypeScript erases it, no
  three.js code ships in the app layer bundle. Per CLAUDE.md the
  enforcement grep is on `import * as THREE` (value import), which would
  still pass. Acceptable; not a violation.
- `bake-service.test.ts` is a test file with a value import. Test scope is
  out of bounds for the layered rule. Acceptable.

`grep -rn "from 'react'\|from \"react\""` in the same headless dirs returns
zero — clean.

`grep -rn "import \* as THREE" packages/`, excluding `__tests__` and
`renderer/`, returns the historical `packages/core/**` god-component files
that pre-date the three-layer refactor. No NEW violations were introduced
by this commit. The new files at `BakedLayout.tsx:17` and
`BakedLayoutColliders.tsx:15` import three inside `packages/world/src/renderer/**`,
which is the allowed location.

**Verdict for §2: zero new layer-rule violations.** The architecture
holds.

---

## 3. SOLID issues

### SRP — Single Responsibility

- **`BakedLayoutColliders.tsx` does two jobs: load AND extract colliders.**
  The `extractMeshAABBs` helper (lines 29–57) traverses the loaded
  geometry inside the same component that subscribes (er, *fails to
  subscribe*) to the bake version. Splitting `useBakedLayoutAABBs(gltf)`
  off as a hook would let unit tests cover the AABB extraction logic
  without R3F mounting. **Minor.** File: `BakedLayoutColliders.tsx:29`.

- **`LayoutApp.tsx` does three jobs: layout mode shell, BakeStatusPill
  state, and optimizer picker.** Both `BakeStatusPill` (lines 98–141) and
  `OptimizerPicker` (lines 39–96) are sub-components defined inside the
  same file. Each subscribes to the registry. Pulling them out as
  siblings would let them be reused by other layout-aware editors and
  shrink LayoutApp to ~150 lines. **Minor.** File: `LayoutApp.tsx`
  whole file.

- **`useLayoutDocument` is fine.** The comment at lines 12–16 about
  *not* abstracting prematurely is the correct call.

### OCP — Open/Closed

- **`BAKE_OPTIMIZERS` is a hardcoded `ReadonlyMap` literal.** Adding a
  strategy requires editing `bake-optimizers.ts` to insert into the Map.
  This is fine for the current single-package codebase but blocks
  external strategy plug-ins (e.g. a downstream package wanting to add a
  Draco-bundled or KTX2-bundled strategy without forking). The
  textbook-OCP refactor would be:

  ```ts
  // registry.ts
  const optimizers = new Map<string, BakeOptimizer>();
  export function registerOptimizer(opt: BakeOptimizer) { optimizers.set(opt.id, opt); }
  export function listOptimizers(): readonly BakeOptimizer[] { … }

  // built-ins.ts
  registerOptimizer(defaultOptimizer);
  registerOptimizer(simplifyLightOptimizer);
  …
  ```

  The current shape is fine for now; flag if/when an external consumer
  needs to add a strategy. **Minor.** File: `bake-optimizers.ts:174–179`.

- **`Scene.tsx:104–110` — single `bakedLayoutPath/Name` prop pair.**
  DebugApp's own comment (lines 122–147) calls this out: `<Scene>` cannot
  render per-room baked layouts because it accepts only one. The fix is
  documented as a future `bakedLayouts?: Array<{path, name}>` prop. The
  current single-string surface is intentional MVP scope and properly
  commented. **Acceptable today; potential debt.** File: `Scene.tsx:104`.

- **`OptimizationMode` enum** at `world-object-kinds-schema.ts:41` —
  declared as a union literal type with an inline `// OCP:` comment
  promising a "compile error in the renderer switch (if one is added)".
  But there IS no consuming switch yet. The OCP claim is aspirational
  until someone wires it in. **Minor doc accuracy issue.** File:
  `world-object-kinds-schema.ts:37–41`.

### LSP — Liskov Substitution

- **`BakedLayout` ↔ `BakedLayoutColliders` violate substitutability of
  the bake-version cache-busting contract.** Both components advertise
  the same "cache-bust on bake settle" behaviour (their identical
  `layoutName` prop and matching `gltfPath?v=` URL construction prove
  they're meant to behave the same). But `BakedLayout` actually
  subscribes; `BakedLayoutColliders` does not. After the SECOND bake of
  a session, only one of them updates. Concrete failure mode:

  1. User edits layout → bake v1 settles → BakedLayout cache-busts to
     `?v=1`, BakedLayoutColliders also reads getVersion → 1, fetches
     `?v=1`. Match.
  2. User edits layout again → bake v2 settles → BakedLayout receives
     subscribe callback, re-renders with `?v=2`. BakedLayoutColliders
     does not re-render (its parent — `Scene` — has no state change).
     It is STILL displaying colliders for v=1. Player can walk through
     newly-added walls.

  **Important.** Files: `BakedLayoutColliders.tsx:107–119` (missing
  effect) and the misleading comment at lines 100–106.

- **`FilesystemLayoutStorage` ↔ `LocalStorageLayoutStorage`** — read both
  and they obey the same observable contract: `load → LayoutDocument |
  null`, `list → LayoutSummary[]`, `save → void`, `delete → void`. Both
  validate via `isValidSceneName` and throw on invalid names. Both
  surface deserialization errors. Behavioural divergence audit:
  - `FilesystemLayoutStorage.list()` throws on non-OK HTTP; the
    localStorage one cannot fail in equivalent way. Behavioural drift
    here is intrinsic to the transport (network can fail). Acceptable.
  - Both `load` correctly return `null` on missing key/404. Match.
  - Both `save` are eager (no batching). Match.

  **LSP OK.** Files: `filesystem-layout-storage.ts`,
  `localstorage-layout-storage.ts`.

### ISP — Interface Segregation

- **`InspectorPanel`'s `roomDoc` prop is the canonical wide-interface
  problem.** `LayoutApp.tsx:245–285` constructs a 30-field shim object
  with no-op functions to satisfy a `useRoomDocument` return-type cast.
  The comment names the principle and the fix-path. The fix is to extract
  a `RoomDocFacade` interface that lists ONLY the methods InspectorPanel
  actually calls (roughly: `selection`, `doc.commands`, `doc.layoutName`,
  `setLayoutName`, `setKindForCommand`, `setPositionForCommand`,
  `deleteSelection`, `groupCommands`, `ungroupCommands`, `lookup.groupOf`).
  Then `useRoomDocument` and `useLayoutDocument` each return objects that
  structurally match the facade, and the shim disappears.

  **Severity = Important** because the shim has a visible downstream
  consequence: InspectorPanel's `LayoutSection` (rendered unconditionally
  at line 80 inside Layout mode) shows a "layout" input field that the
  no-op `setLayoutName` silently swallows. Either hide the section when
  the doc has no `layoutName` slot, or fix the ISP properly. Files:
  `LayoutApp.tsx:236–285`, `InspectorPanel.tsx:36–82`.

- **`BakeDeps`** (`bake-registry.ts:32–46`) is well-scoped: only the
  registry depends on `publish`, and only `bakeLayout` reads
  `kindLookup`/`gltfLoader`/`geometry`. The function signature of
  `bakeLayout(doc, kindLookup, gltfLoader, geometry, options?)` correctly
  takes the three it needs as positional args rather than the full
  `BakeDeps`. **ISP OK.**

### DIP — Dependency Inversion

- **Bake → geometry is the DIP poster child for this commit.** Before:
  `bakeLayout` reimplemented voxel→world math. After: it depends on the
  `InstanceGeometryService` interface, passed in by the caller (browser
  bake deps factory or CLI). Both runtime (`<ObjectInstances>`) and bake
  consume the SAME concrete implementation by sharing the SAME service
  instance from `useApplication`. **Excellent.** Files:
  `layout-bake-service.ts:102–112`, `bake-registry.ts:32–46`,
  `layout-bake-service-browser.ts:28–31`,
  `scripts/bake-layout.ts:119–124`.

- **`createBrowserBakeDeps`** correctly takes `CatalogService +
  InstanceGeometryService` (the abstractions), not a concrete React
  context. It can be called from a Node test that mocks both. Good.
  File: `layout-bake-service-browser.ts:28`.

- **`BakedLayout` material override is properly inverted.** The
  `materialOverride` callback (lines 26, 43–53) is injected from the
  editor; the renderer doesn't know about editor-specific variants.
  Documented inline at `BakedLayout.tsx:48`. Good.

- **Half-step:** `BAKE_OPTIMIZERS` registry is concrete-class-aware in
  the sense that `apply` is an opaque method. A more inverted design
  would expose `transforms(): Transform[]` so callers could compose:
  `[...defaultOptimizer.transforms(), simplify({...})]`. See §4 for the
  full alternative.

---

## 4. Cross-cutting observations

### 4.1 BakeOptimizer abstraction is opaque rather than compositional

The `BakeOptimizer.apply(doc)` shape buries the transforms inside an
async method. Two concrete consequences:

1. **You can't compose.** "I want the default pipeline minus `weld`" or
   "I want `simplify` after my custom step" requires writing a new
   strategy from scratch (or copy-pasting the line `await doc.transform(...)`).
2. **You can't introspect.** A test that wants to assert "the default
   strategy runs at least N passes" can't get at the transform list.

Cleaner alternative:

```ts
import type { Transform } from '@gltf-transform/core';

export interface BakeOptimizer {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  /** The ordered list of transforms this strategy applies. */
  transforms(): readonly Transform[];
}

// The bake service then composes:
await outDoc.transform(...optimizer.transforms());
```

This keeps the registry pattern, keeps the per-strategy semantics in one
place, AND lets a caller say:

```ts
await outDoc.transform(
  ...defaultOptimizer.transforms(),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.001 }),
);
```

Worth doing before a second consumer of `apply` lands.

File: `bake-optimizers.ts:60–62`.

### 4.2 Inline IIFE in `DebugApp` for `bakedLayoutName`

`DebugApp.tsx:148–167` derives the layout name via an inline IIFE that
runs on every render. The result is a `Set` rebuild + an iteration over
`mapDoc.rooms`. For small maps this is fine (microseconds); for hot-loop
re-renders during physics it's wasteful.

Lift to a `useMemo` keyed on `picker.mapDoc, picker.rooms`. Also: the
`console.warn` will fire on EVERY render when the multi-layout case
hits, which produces an unbounded log stream. Move the warn into a
`useEffect` so it fires once per map change.

**Minor.** File: `DebugApp.tsx:148`.

### 4.3 LayoutApp's optimizer-write skips undo history

`useLayoutDocument.setOptimizer` (line 270–280) intentionally does not
push to undo history. The comment explains. This is a correct
SRP-respecting decision (optimizer is doc metadata, not a reversible
edit) — but it means a user who flips optimizers and immediately Ctrl-Z
their last placement will find the optimizer choice has NOT been
restored to whatever it was at the time of that placement.

If that becomes a UX confusion source, treat optimizer as a top-level
"settings" field (persisted but outside command history) consistently
across all editors. Document as "optimizer = settings; commands = doc".

**Minor.** File: `useLayoutDocument.ts:268–280`.

### 4.4 Dead deprecated import

`filesystem-room-storage.ts:3` imports `migrateToV3` (deprecated) and
`migrateToV5`. Only `migrateToV5` is used. Dead import. **Minor.**

### 4.5 `scripts/bake-layout.ts` CLI arg parser

The argv parser at lines 167–182 is correct but easy to misread.
`args.filter((a, i) => ... args[i - 1] !== '--optimizer')` skips a
positional value that follows `--optimizer`, but ONLY when the user used
the space form. The equals form (`--optimizer=foo`) is handled
correctly by the startsWith branch.

What if the user writes `pnpm bake-layout --optimizer my-layout`? The
parser treats `my-layout` as the optimizer value and then has zero
targets — error "Usage: …". That's a confusing diagnostic for what is
probably a user error.

Consider switching to a tiny argv parser library, OR adding an explicit
"layout names must come last" hint in the usage string. **Minor.**

### 4.6 Documentation discipline is excellent

Every new file in `packages/world/src/app/` has a clear top-comment
that states (a) what the module does, (b) what layer it lives in, (c)
what it must NOT import. Several SOLID violations are inline-commented
per CLAUDE.md's "doc-the-reason" policy:
`LayoutApp.tsx:236–244, 262–266`, `BakedLayout.tsx:48`,
`LayoutEditorCanvas.tsx:1–17`, `layout-bake-service.ts:228–232` (the
Draco DIP note).

This is the kind of in-code documentation discipline that makes
follow-up reviews tractable. Keep doing it.

---

## 5. Verdict

**Ship.** This is one of the cleanest commits I've reviewed in this
codebase. The DIP rewiring of the bake service to consume
`InstanceGeometryService` is exactly the kind of cross-layer
deduplication the refactor plan calls for. Layer rules are obeyed
without exception in the new code.

The follow-up work needed to take this from "good" to "great" is real but
small:

1. Fix `BakedLayoutColliders` subscription (LSP/Important).
2. Hide the InspectorPanel's `LayoutSection` from Layout mode, or
   refactor InspectorPanel to a narrow interface (ISP/Important — but
   the latter is the right long-term fix).
3. Consider the compositional-transforms shape for `BakeOptimizer`
   before a second consumer of `apply` lands.
4. Memoise the `bakedLayoutName` derivation in DebugApp.

None of these are ship-blockers.

**Compliance score against the architectural rules: 90 / 100.**

Breakdown:
- Layered architecture: 25 / 25 (zero new violations; greps clean).
- DIP: 22 / 25 (geometry inversion is excellent; optimizer interface is
  the half-step described in §4.1).
- SRP: 18 / 20 (`LayoutApp.tsx` and `BakedLayoutColliders` are slightly
  doing two jobs each).
- ISP: 13 / 15 (`InspectorPanel` ISP shim is documented but has a
  visible UX consequence).
- OCP / LSP: 12 / 15 (BakeOptimizer registry is editable-only;
  `BakedLayout`/`BakedLayoutColliders` LSP drift on bake settle).
