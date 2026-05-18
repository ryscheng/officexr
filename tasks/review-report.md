# Code Review Report — Post-Auto-Fix (Re-review)

## Summary

Re-review of the two Critical issues from the prior review. Both fixes
verify clean. Studio (192/192) and world (205/205) test suites still
pass; no new Critical issues introduced. Remaining Important and Minor
issues from the prior review are **out of scope** for this re-review
and remain as documented follow-ups, not blockers.

**Recommendation: SHIP.**

---

## Critical Fix Verification

### Fix 1 — InspectorPanel `/api/layouts` shape

**File**: `packages/studio/src/modes/room/InspectorPanel.tsx:39-49`

**Prior bug**: Fetch cast the response body to `string[]`, but the
Vite plugin actually returns `{ layouts: ResourceSummary[] }`
(verified at `packages/world/vite-plugin-storage.ts:121` where
`listKey: 'layouts'` and `packages/world/vite-plugin-storage.ts:351`
writes `{ [opts.listKey]: out }`). The autocomplete datalist would
never populate.

**Fix applied**:
```ts
fetch('/api/layouts')
  .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
  .then((data: { layouts: { name: string }[] }) =>
    setAvailableLayouts(data.layouts.map((l) => l.name)),
  )
  .catch(() => { /* non-blocking */ });
```

**Verification**:
- Response shape matches the Vite plugin's
  `jsonResponse(res, 200, { [opts.listKey]: out })` where each entry
  in `out` is a `ResourceSummary` containing `name: string`
  (`vite-plugin-storage.ts:144,330,339,351`). ✅
- `data.layouts.map((l) => l.name)` correctly extracts the `string[]`
  the datalist consumes at line 75. ✅
- Adds `r.ok` gate before `r.json()` — defends against the route
  being unavailable in test / localStorage environments (the
  prior implementation would have parsed a 404 HTML body). ✅
- `.catch(() => {})` swallow is acceptable here — the dev-only
  autocomplete is a UX nicety, not a correctness path. ✅

**Status**: ✅ Correctly implemented.

### Fix 2 — DebugApp baked-layout wiring

**Files**:
- `packages/studio/src/modes/debug/useMapPicker.ts:39-63,127-128,156-166,302`
- `packages/studio/src/modes/debug/DebugApp.tsx:122-170,201-202`

**Prior bug**: The runtime `<Scene>` in DebugApp did not pass
`bakedLayoutPath` / `bakedLayoutName`, so baked walls and their
static colliders never rendered in the play path — players walked
through walls. PRD goal #4 ("Preserve physics — players still
collide with walls and floors") was unmet.

**Fix applied** in `useMapPicker.ts`:
- New `MapPickerState.rooms: ReadonlyMap<string, RoomDocument>`
  (line 49-52) and `MapPickerState.mapDoc: MapDocumentV1 | null`
  (line 53-55), populated in `loadMap` (lines 156-166) where the
  rooms map is already constructed for compileMap, so exposing it is
  free — no new I/O.
- `setRooms` / `setMapDoc` are called in lockstep with the existing
  `setWorldObjects` call, so observers always see consistent state.
- Returned from the hook alongside the existing surface (line 302).

**Fix applied** in `DebugApp.tsx`:
- Lines 148-170: derives `bakedLayoutName` by collecting the
  distinct `layoutName` values from every `RoomDocument` referenced
  by the active map's `RoomInstance` list.
- Single distinct layout → returned for `<Scene>` to bake. ✅
- Multiple distinct layouts → logs a warning and returns `undefined`
  (graceful degradation; voxel WorldObjects still render). ✅
- No layouts / no map → `undefined`. ✅
- `bakedLayoutPath` (line 168-170) URL-encodes the layout name to
  match the rest of the codebase's `/api/baked-layouts/<encoded>`
  convention.
- Both props threaded into `<Scene>` at lines 201-202.

**Verification of correctness**:
- Data flow: `useMapPicker.loadMap` loads each `RoomDocument` for the
  selected map's `RoomInstance`s into a `Map<string, RoomDocument>`,
  then both `setRooms(rooms)` and `setMapDoc(map)` publish via
  React state (lines 164-165). `DebugApp` reads
  `picker.rooms` + `picker.mapDoc` and iterates `mapDoc.rooms` (the
  `RoomInstance[]`), looking each up in the rooms map to read its
  `layoutName`. This matches the actual `MapDocumentV1` shape —
  `mapDoc.rooms` is the `RoomInstance[]`, and `rooms.get(ri.roomName)`
  yields the `RoomDocument` (with its `layoutName` field added by
  the v5 migration). ✅
- Inline ISP / TODO comments at lines 124-147 document the
  scope-of-MVP decision (Scene's prop surface is single-layout) and
  the multi-layout-map workaround in the spirit of CLAUDE.md's
  "document the SOLID violation reason inline" rule. ✅
- Warning at line 158-164 includes the map name and the set of
  conflicting layouts so a multi-layout map is debuggable from the
  console without source diving. ✅
- `bakedLayoutPath` is derived only if `bakedLayoutName` is defined
  (line 168), so `<Scene>`'s `Boolean(bakedLayoutPath) &&
  Boolean(bakedLayoutName)` early-guard sees a consistent pair —
  no risk of a half-set props pair. ✅

**Status**: ✅ Correctly implemented.

---

## Test Execution

| Check | Result | Details |
|-------|--------|---------|
| `packages/world` test suite | Passed (205/205) | 21 test files, 1.88s |
| `packages/studio` test suite | Passed (192/192) | 17 test files, 3.48s |

Both fixes ship green. Counts are unchanged from the prior run, which
confirms the fixes are surgical — no test file was inadvertently
deleted or skipped to make the suite pass.

---

## Did the fixes regress any of the previously-flagged Important / Minor issues?

Checked each Important / Minor item to be sure the surgical fixes
didn't make anything worse:

| Prior issue | Status after fix |
|-------------|------------------|
| `<BakedLayoutColliders>` doesn't subscribe to bake-registry transitions | Unchanged. The DebugApp wiring now exposes this code path at runtime where it previously was editor-only, which makes the consequence more user-visible — but the fix doesn't make the underlying bug worse. Still an Important follow-up. |
| `<BakedLayout>` lacks 404 recovery | Unchanged. Same dynamic as above — the runtime wiring now exercises the code path. Important follow-up. |
| `layout-bake-service.test.ts` missing "fewer primitives" assertion | Unchanged. |
| No round-trip test for `FilesystemLayoutStorage` / `LocalStorageLayoutStorage` | Unchanged. |
| `setLayoutName` per-keystroke `awaitFresh` | Unchanged. |
| `bake-registry.ts` supersede branch untested | Unchanged. |
| `InspectorPanel` datalist doesn't live-refresh after creating a new layout | Unchanged. |
| `LayoutApp.tsx` `roomDocCompat` shim silent `setLayoutName` no-op | Unchanged. |
| `BakedLayout.tsx` stale-closure read of `version` | Unchanged. |
| Missing tests for `useLayoutDocument` / `LayoutApp` / `ObjectPalette.layoutFilter` | Unchanged. |

No prior issue was made worse by the fixes. The two
"now-runtime-exposed" items (BakedLayoutColliders subscribe + 404
recovery) were already flagged Important and remain so — the fix
correctly extends the existing rendering pipeline rather than
working around it, which is the right call.

---

## New Issues Introduced

### Critical
None.

### Important
None.

### Minor
- **`DebugApp.tsx:148-167` — IIFE-style derivation runs on every
  render.** The `const bakedLayoutName = (() => { … })()` block
  recomputes the Set + loop on every render. For a typical map with
  <20 rooms this is negligible (~microseconds), but if the map grows
  it would be trivially memoizable with `useMemo` keyed on
  `[picker.mapDoc, picker.rooms]`. Not a regression; pure
  optimization opportunity.

---

## What Looks Good (post-fix)

- **`useMapPicker` state additions are exposed in lockstep with the
  existing `setWorldObjects` call** (lines 162-165), so any consumer
  reading `rooms` / `mapDoc` sees state consistent with the SDK
  store. No torn-write window.
- **The multi-layout case is handled visibly, not silently.** A
  `console.warn` plus a code comment that names the eventual fix
  (per-instance `<BakedLayout>` like MapEditorCanvas does) means a
  user encountering this won't have to spelunk for the cause.
- **The TODO at lines 138-143 reads as a deliberate MVP scope
  boundary, not unfinished work**, and it correctly identifies the
  shape of the future fix (`bakedLayouts?: Array<{path, name}>` prop
  on `<Scene>`). Matches the CLAUDE.md "document the principle / why
  / what would unbreak" pattern.
- **Both new state fields are typed properly** —
  `ReadonlyMap<string, RoomDocument>` (not `Map`) prevents external
  mutation; `MapDocumentV1 | null` is the same union the storage
  layer already uses.

---

## Final Recommendation

**SHIP.**

Both Critical fixes are correct, the test suites are green, and no
new Critical issues were introduced. The remaining Important and
Minor items are pre-flagged follow-ups (collider re-subscription,
404 recovery, test-coverage gaps) that should be tracked but do not
block this release. Each is small, isolated, and well-understood.
