# Code Review — Task 2: Storage layer + Vite middleware unification

## Summary

Task 2 ships the new unified plugin + four typed storage classes, all spec endpoints (`/api/rooms`, `/api/maps`, `/api/cube-kinds`, `/api/scenes`) are mounted, the deprecated shim re-exports cleanly, security parity is preserved, typecheck + 57/57 tests green. **No Critical issues.** Two Important issues to triage before Task 3 (one is a missed spec test, one is a subtle PluginOptions back-compat break). A handful of Minor cleanups.

## PRD Compliance

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 1 | Replace plugin with `vite-plugin-storage.ts` mounting `/api/rooms/:name`, `/api/maps/:name`, `/api/cube-kinds` via a generic helper | Complete | `vite-plugin-storage.ts:76-105`; `makeJsonResourceMiddleware` factored for rooms+maps, `makeSingleDocumentMiddleware` for catalog. |
| 2 | Keep `/api/scenes` mounted for back-compat | Complete | `vite-plugin-storage.ts:96-105`. Controlled by `legacyScenes.disable` opt-out. |
| 3 | `FilesystemRoomStorage` typed to return `RoomDocument` (v3) directly | Complete | `filesystem-room-storage.ts:44-54`; pipes through `migrateToV3`. |
| 4 | `LocalStorageRoomStorage` typed to `RoomDocument` + migrates on load | Complete | `localstorage-room-storage.ts:73-84`. |
| 5 | `FilesystemMapStorage` typed to `MapDocumentV1` | Complete | `filesystem-map-storage.ts:34-42`. |
| 6 | `LocalStorageMapStorage` typed to `MapDocumentV1` | Complete | `localstorage-map-storage.ts:55-66`. |
| 7 | Update `packages/studio/vite.config.ts` to use unified plugin | Complete | `vite.config.ts:3,29`. Comment block accurately describes all four mounts. |
| 8 | Keep `vite-plugin-scene-storage.ts` as a deprecated shim re-exporting the new plugin | Partial | Shim re-exports the plugin default + a renamed type, but the option SHAPE is incompatible — see Important #2. |
| 9 | Defer `FilesystemCatalogStorage` to Task 3; mount endpoint as generic single-document GET/PUT | Complete | `makeSingleDocumentMiddleware` is in place; no `FilesystemCatalogStorage` class was added, per the task summary. (Plan text in Task 2 lists `FilesystemCatalogStorage` itself; this implementation's deviation matches the prompt's clarification "Defer FilesystemCatalogStorage to Task 3".) |
| 10 | Tests: round-trip GET/PUT/DELETE through both Filesystem AND LocalStorage variants, migration on load | Partial | Only LocalStorage variants are covered. No mock-fetch round-trip for `FilesystemRoomStorage` / `FilesystemMapStorage`. See Important #1. |

**Compliance Score**: 8/10 fully met; 2 partial (one is a deviation that matches the prompt's clarification, one is a missed test, one is a subtle option-shape break).

## Issues Found

### Critical (must fix before shipping)
*None.*

### Important (should fix)

- **`packages/world/src/scenes/room-map-storage.test.ts` (entire file)**: The plan's Task 2 test requirement was *"round-trip GET/PUT/DELETE through both Filesystem and LocalStorage variants (mock fetch)"*. Only the LocalStorage variants are exercised. No `FilesystemRoomStorage` / `FilesystemMapStorage` tests with mocked `global.fetch` exist. That's the side of the contract that interacts with the new middleware — the Filesystem classes are where the migration-on-load (`migrateToV3(deserializeScene(raw))`) actually runs in production, and where slug validation, 4xx mapping, and the `{ rooms: [...] }` envelope shape live. A minimal `vi.stubGlobal('fetch', vi.fn(...))` test for each Filesystem class would close this gap.

- **`packages/world/vite-plugin-scene-storage.ts:15`**: The shim re-exports `StudioStoragePluginOptions as SceneStoragePluginOptions`, but the option SHAPES are incompatible. The original `SceneStoragePluginOptions = { scenesDir?: string; basePath?: string }`; the new `StudioStoragePluginOptions = { rooms?: {...}; maps?: {...}; catalog?: {...}; legacyScenes?: {...} }`. Any caller doing `import scenes from '@officexr/world/vite-plugin-scene-storage'; scenes({ scenesDir: 'foo', basePath: '/api/scenes' })` will silently get those options dropped (the new plugin doesn't read either field) — the test runner won't catch it because there are no callers in-repo. Either map the legacy fields explicitly in the shim (`{ scenesDir, basePath } → { legacyScenes: { dir: scenesDir, basePath } }`) or document in the shim that the option shape changed.

### Minor (nice to fix)

- **`packages/world/tsconfig.json:19`**: `include` still lists `vite-plugin-scene-storage.ts` but not the new `vite-plugin-storage.ts`. The latter is currently typechecked transitively through the shim's `export { default } from './vite-plugin-storage.ts'`, but if the shim is ever deleted (Task 5+), the new plugin file will silently fall out of typecheck. Add `vite-plugin-storage.ts` to the include list explicitly.

- **`packages/world/vite-plugin-storage.ts:122-155`**: The `try { ... } catch { ... next?.(); }` pattern sends the 500 response AND calls `next?.()`. After `res.end(...)`, calling `next()` will trigger downstream middleware that tries to write to a finished response. The original plugin had the same shape (`vite-plugin-scene-storage.ts:88-95` pre-shim), so this is behavior-preserved, but it's worth fixing in this refactor since both copies of the bug exist now.

- **`packages/world/vite-plugin-storage.ts:161-205`**: `makeSingleDocumentMiddleware` doesn't validate that `req.url` is `/` — `PUT /api/cube-kinds/anything/at/all` will overwrite the same `cube-kinds.json` file. The handler should 404 (or 405) when the URL has a non-empty tail. The catalog file path is hardcoded, so this isn't a traversal vector, but it's a sloppy contract that a sloppy client could lean on.

- **`packages/world/vite-plugin-storage.ts:211-239`** (`handleList`): A `rooms/foo.json` containing a v1 or v2 doc would still pass `deserializeScene`. The summary's `updatedAt`/`title` would be taken from a legacy doc that the consumer (`FilesystemRoomStorage`) will then promptly migrate on load. Not wrong — but inconsistent: list says "this is a room" while load returns a v3 doc that was actually a v2 on disk. Either list should reject non-v3 entries (warn + skip), or this implicit-coercion behavior should be commented.

- **`packages/world/vite-plugin-storage.ts:267-283`** (`handlePut`): Casts `parsed` to `{ name: string }` and `{ updatedAt?: number }` and mutates both. Works for `SerializedScene` and `MapDocumentV1`, but the cast lets the next maintainer accidentally use this helper for a payload shape where `name` isn't mutable (or doesn't exist). A typed constraint on `JsonResourceOpts.validate`'s return (already `{ name: string; title?: string; updatedAt?: number }`) makes the casts unnecessary — drop the casts.

- **`packages/world/vite-plugin-storage.ts:268`**: Type `let parsed: SerializedScene | MapDocumentV1;` is hard-coded to the two current resource shapes. If a future caller adds a third resource type (e.g. characters), they'll have to widen this union too. The validate callback already constrains the type — `let parsed: ReturnType<typeof opts.validate>` would be more durable.

- **`packages/world/src/scenes/room-map-storage.test.ts:12-32`**: `MemoryStorage` class is duplicated verbatim from `packages/world/src/scenes/storage.test.ts:12-32`. Hoist into a shared test helper (e.g. `packages/world/src/scenes/__test-helpers__/memory-storage.ts`) to avoid divergence.

- **`packages/world/src/scenes/room-map-storage.test.ts`**: No "rejects malformed payload" test for `LocalStorageRoomStorage` — the map suite has one (`:141-148`) but the room suite doesn't. Add `it('rejects malformed payload on load', async () => { ... })` for symmetry; the room storage is where the `migrateToV3(deserializeScene(...))` chain runs, so this is the higher-value test of the two.

- **`packages/world/src/scenes/filesystem-room-storage.ts:38`** and **`filesystem-map-storage.ts:28`**: `await fetch(this.base, { method: 'GET' })` — list endpoints use the unprefixed base path. The Vite middleware sees the request as `/` after mount-prefix stripping, which is what `handleList` checks. Works, but worth a comment: the base path with no trailing slash hits the empty-slug branch by design.

- **`packages/world/src/scenes/filesystem-map-storage.ts:34-42`** (`FilesystemMapStorage.load`): Unlike `FilesystemRoomStorage.load`, this doesn't catch JSON-parse / shape errors with a wrapped message that includes the resource name. If the server returns a malformed body, the user sees the raw `deserializeMap` error (e.g. `"map: not an object"`) with no indication of which map name failed. The LocalStorage variants wrap the message (`localstorage-room-storage.ts:81`, `localstorage-map-storage.ts:64`); the Filesystem variants don't. Small UX gap.

- **`packages/world/src/scenes/localstorage-room-storage.ts:92`** and **`localstorage-map-storage.ts:74`**: `idx[name] = { title: ..., updatedAt: room.updatedAt ?? Date.now() }` — the index gets `Date.now()` when the doc has no `updatedAt`, but the stored payload doesn't. Subsequent loads return a doc with `updatedAt: undefined` while `list()` reports a `updatedAt: <save-time>`. Same divergence as the legacy `LocalStorageSceneStorage:86`, so consistent — but if Task 6+ relies on the doc's own `updatedAt` for sync, this will surface. Worth either writing the timestamp back into the doc before storing, or noting the divergence in the doc header.

- **`packages/world/vite-plugin-storage.ts:151`**: `(err as Error).message` is sent to the client in the 500 body. The original plugin did this too, so behavior-preserved. Dev-only plugin, low risk, but in principle leaks Node-internal error messages (e.g. `EACCES`-style FS errors) to the browser. Consider returning `{ error: 'internal' }` and logging the detail server-side.

- **`packages/studio/README.md:9`**: Still references `vite-plugin-scene-storage` middleware — should be updated to mention the unified plugin in the same pass that renames Scenes → Room.

- **No `tasks/implementation-notes.md`**: Task 1 review flagged the missing notes file; Task 2 hasn't added one. The non-obvious decisions in this task — keeping the legacy-options shim name but changing its shape, NOT writing a `FilesystemCatalogStorage` class, the `validate`-then-pass-raw-bytes pattern in handleGet, the explicit `legacyScenes.disable` opt-out — are exactly the kinds of decisions CLAUDE.md says should be documented.

## What Looks Good

- **Plugin doc-comment at `vite-plugin-storage.ts:35-54`** lists every mounted route, the response shape, and the dev-only constraint. The block above `StudioStoragePluginOptions` clearly explains the back-compat policy for `/api/scenes`. The shim file's `@deprecated` JSDoc tells future-callers exactly where to import from instead.
- **SOLID adherence holds**: `grep -rn "from 'three'" packages/sdk packages/realtime-server packages/core-refactor` returns 0 matches; `grep -rn "from 'three'\|from 'react'" packages/world/src/scenes` returns 0 matches. The new `FilesystemRoomStorage`/`MapStorage` classes import only `serialize.ts`, `storage.ts`, and the new map-document type — no upward dependencies. DIP holds.
- **Generic middleware factory** is well-factored: `makeJsonResourceMiddleware({dir, listKey, validate})` correctly parameterizes the per-resource bits (filesystem path, JSON envelope key, validator). The handle{List,Get,Put,Delete} helpers are reused across both rooms and maps with no copy-paste. Security primitives (slug validation, 5 MB cap, ENOENT → 404) are in one place.
- **Security parity is preserved**: `isValidSceneName` is applied at the same point (`vite-plugin-storage.ts:135`), `readBody`'s 5 MB cap is identical (`:300-316`), `handlePut` still forces `parsed.name = slug` (`:276`) and stamps `updatedAt` (`:277`) — closes the URL/payload-slug-mismatch hole. `handleGet`/`handleDelete` use `path.join(dir, slug + '.json')`, with `slug` already gated by `isValidSceneName`, so traversal stays off the table.
- **Type integrity is strong**: `RoomStorage.load: Promise<RoomDocument | null>` always returns v3 — both implementations run `migrateToV3` on load. `MapStorage.load: Promise<MapDocumentV1 | null>` — `deserializeMap` rejects anything that isn't `schemaVersion: 1`, so the type never lies. The interfaces are properly segregated: `RoomStorage` doesn't extend `SceneStorage`, so a caller that wants v3 docs only is statically prevented from accepting a v1/v2 file.
- **Test coverage of the LocalStorage variants is meaningful**: every test asserts on a specific field of a specific shape (`schemaVersion === 3`, `groups['g-1'].commandIds === ['cmd-1']`, `not toHaveProperty(...)`-style migration checks). No `toBeDefined()` filler. The migration-on-load test (`room-map-storage.test.ts:79-100`) writes a real v2 serialized doc and asserts the load returns a v3 doc with empty groups — a real regression catcher.
- **Filesystem dir-default + override seam is clean**: each resource has `DEFAULT_*_DIR` constants resolved relative to the plugin file, with override fields on the options. The test seam this opens up (a future `FilesystemRoomStorage` integration test could mount the plugin at a temp dir) is exactly the shape Task 6+ will want.
- **Back-compat path is intact**: `/api/scenes` still serves `packages/world/scenes/` (`vite-plugin-storage.ts:67,100`). The legacy `FilesystemSceneStorage` at `packages/studio/src/modes/scenes/useSceneDocument.ts:63` continues to hit `/api/scenes/<name>` — unmodified by this task. Manual `pnpm dev` smoke would confirm; I didn't boot the dev server but the contracts match.

## Test Coverage

| Area | Tests Exist | Coverage Notes |
|------|-------------|----------------|
| `LocalStorageRoomStorage` save/load round-trip | Yes | `room-map-storage.test.ts:52-59`. |
| `LocalStorageRoomStorage` list | Yes | `:61-66`. |
| `LocalStorageRoomStorage` load returns null for unknown | Yes | `:68-70`. |
| `LocalStorageRoomStorage` delete | Yes | `:72-77`. |
| `LocalStorageRoomStorage` v2 → v3 migration on load | Yes | `:79-100` — proves the migration runs against a real serialized v2 doc. |
| `LocalStorageRoomStorage` invalid name rejection | Yes | `:102-105`. |
| `LocalStorageRoomStorage` malformed payload | No | Missing — see Minor. |
| `LocalStorageMapStorage` save/load round-trip | Yes | `:125-132`. |
| `LocalStorageMapStorage` list | Yes | `:134-139`. |
| `LocalStorageMapStorage` malformed payload | Yes | `:141-148`. |
| `LocalStorageMapStorage` delete | Yes | `:150-155`. |
| `FilesystemRoomStorage` GET/PUT/DELETE (mock fetch) | **No** | Spec required this; not implemented. |
| `FilesystemMapStorage` GET/PUT/DELETE (mock fetch) | **No** | Spec required this; not implemented. |
| Vite middleware integration (mounted plugin against tmp dirs) | No | Out of scope per the plan, but worth flagging — the back-compat `/api/scenes` mount has zero automated coverage. |

**Test Coverage Assessment**: Adequate for the LocalStorage half, weak on the Filesystem half. The Filesystem classes are where the more interesting logic lives (network round-trip semantics, status-code mapping, slug encoding) and where Task 11+ debounced-save logic will plug in. A 2-3 test mock-fetch pass would close the spec gap inside a single Edit.

## Test Execution

| Check | Result | Details |
|-------|--------|---------|
| Test command discovered | Yes (`pnpm --filter @officexr/world test`) | From `packages/world/package.json:18`. |
| Test suite run | Passed (57/57) | 6 files, 332ms tests. |
| Typecheck (world) | Passed | `pnpm --filter @officexr/world typecheck` clean. |
| Typecheck (studio) | Passed | `pnpm --filter @officexr/studio typecheck` clean — confirms the deprecated `FilesystemSceneStorage` import in `useSceneDocument.ts:3` still resolves. |
| DIP greps | Passed | 0 matches for `from 'three'` in sdk/realtime-server/core-refactor; 0 for `three`/`react` in `packages/world/src/scenes`. |
| TDD evidence in implementation notes | N/A | No `tasks/implementation-notes.md` exists. |

**Test Execution Assessment**: All automated checks pass. The Filesystem-storage gap is a coverage hole, not a failure — the code typechecks and the LocalStorage proxy exercise the same migrate-on-load chain, so the risk is contained but real.

## Implementation Decision Review

| Task | Decisions Documented | Decisions Sound | Flags |
|------|---------------------|----------------|-------|
| Task 2 | Partially | Mostly | (a) The decision to NOT add a `FilesystemCatalogStorage` class (deferred to Task 3) matches the prompt clarification but isn't called out in code or notes. (b) The shim's option-shape rename is undocumented. (c) The `try/catch/next?.()` pattern was inherited rather than fixed. None of these are wrong by themselves, but they're the kind of "why did the implementer do this?" calls that an `implementation-notes.md` exists for. |

**Decision Assessment**: The architectural choices are sound — generic helper factored cleanly, security primitives preserved, type integrity strong. The decisions that warrant documentation are mostly about the back-compat shim and the deferral of catalog typing.

## Recommendations

1. **Ship Task 2** after fixing Important #1 (add Filesystem variant tests with mock-fetch). It's a 30-line patch and closes the spec gap.
2. **Decide Important #2** before Task 5: either map the legacy `SceneStoragePluginOptions` fields explicitly in the shim, or remove the type alias and add a deprecation message in the shim's JSDoc that names the new option shape. The current state silently breaks any external caller that passed the old options.
3. **Add `tasks/implementation-notes.md`** capturing: the catalog-storage class deferral, the option-shape rename, and the `legacyScenes.disable` switch (so Task 5's deprecation can find it).
4. **Before Task 3**: add `vite-plugin-storage.ts` to `packages/world/tsconfig.json` `include`. The transitive include via the shim is fragile.
5. **Fold into Task 3 (or a small chore commit)**: hoist `MemoryStorage` into a shared test helper, add the `rejects malformed payload` test for room storage, fix `handlePut`'s casts to a typed `ReturnType<typeof opts.validate>`, and guard `makeSingleDocumentMiddleware` against non-root URLs.
6. **Trivial cleanup**: the existing `try/catch/next?.()` shape should be `next?.()` removed from the catch (or `if (!res.writableEnded) next?.()`); update `packages/studio/README.md` to mention the unified plugin.
