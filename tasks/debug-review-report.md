# Debug Fix Review Report

## Summary

The fix is a low-risk, well-tested diagnostic hardening change. It does NOT resolve the primary T-pose scenario identified in the diagnosis (a GLB with **zero** clips still leaves `localAvatarAnimationRef.current === null`, so `switchAnimation` is never called and the walk→idle fallback never runs). It does add two genuinely valuable improvements: (1) an actionable `console.warn` so the clipless-GLB case is no longer silent, and (2) a walk→idle fallback that handles the *narrower* partial-clip case (GLB has idle but no walk). Tests pass 231/231. Overall, ship-ready as a diagnostic / partial hardening — but the diagnosis's "most likely actual cause" (zero-clip GLB) is still only *detectable*, not *fixed*, in code by these changes.

**Compliance score: 8 / 10**

## Debug-Criteria Compliance

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | Fix addresses the root cause from the diagnosis | Partial | The diagnosis's primary hypothesis is a zero-clip GLB. For that case, the code path never reaches `switchAnimation` (ref stays null → `useKeyboardControls.ts:427` guard skips). Only the `console.warn` helps diagnose that case; the walk→idle fallback addresses a narrower partial-clip case. Diagnosis explicitly flags the asset itself as the fix; code change is correctly scoped as "hardening." |
| 2 | No regressions introduced | Complete | Changes are additive. `switchAnimation`'s existing branches are preserved; walk→idle only engages when the primary lookup returns undefined AND `desiredName === 'walk'`. `console.warn` is diagnostic-only. setup.ts changes are purely additive (rotation.set, Box3, clipAction). |
| 3 | Test written and adequate | Complete | 9 test cases across `switchAnimation` and `loadGLTFIntoGroup`. Tests call the code, assert on side-effects (play/reset/fadeOut calls, activeAction state, warnSpy), and cover the both-missing edge case. See Test Adequacy below. |
| 4 | Changes minimal and focused | Complete | Two targeted edits in Avatar.tsx (~10 lines total) plus additive test infra. No drive-by changes. |
| 5 | `pnpm test` passes | Complete | 231/231 tests pass (10 test files). Observed directly. |
| 6 | Both-walk-and-idle-missing edge case handled | Complete | Walk through: desiredName='walk' → walk lookup fails → idle lookup fails → `action` undefined → `if (action)` false → `else if (desiredName === 'idle' ...)` false (desiredName is 'walk'). No-op, no crash, activeAction unchanged. Covered by test at lines 93–97 ("does not crash when neither walk nor idle clip exists"). |
| 7 | `console.warn` fires before `onAnimationsReady?.(null)` | Complete | Avatar.tsx:460–463 — warn is on line 460, `onAnimationsReady` on line 463. Correct ordering. Test at lines 213–220 verifies both call patterns. |

## Issues Found

### Critical
None.

### Important

- **`packages/core/src/components/Avatar.tsx:41–63`** (conceptual / scope): The walk→idle fallback does NOT fix the diagnosis's primary hypothesis. The diagnosis states the T-pose occurs when `gltf.animations.length === 0`, in which case `loadGLTFIntoGroup` calls `onAnimationsReady?.(null)`, `localAvatarAnimationRef.current` stays `null`, and `useKeyboardControls.ts:427` short-circuits before `switchAnimation` is even called. So the fallback only helps the **partial-clip** case (GLB has idle but no walk) — a case the diagnosis does not claim to be the bug. The implementation notes correctly identify this as the narrower case, but neither the notes nor the code change state that the zero-clip case remains unfixed at the code layer. Recommendation: document in implementation-notes.md that the zero-clip scenario is intentionally left as an asset-level fix (per diagnosis recommendation #3) and the console.warn is the only code-side mitigation.

- **`packages/core/src/components/Avatar.tsx:46`**: The walk→idle fallback is hard-coded to only trigger for `desiredName === 'walk'`. The inverse (idle missing → fall back to walk) is not covered, but there's an existing else-branch at line 58 that fades out to bind pose for the missing-idle case. That is arguably correct behaviour (idle-while-moving is wrong, but T-pose-while-stopped is less wrong than T-pose-while-walking). No change requested; flagging for awareness in case future review reconsiders.

### Minor

- **`packages/core/src/components/Avatar.tsx:461`**: Warning string uses a template literal with a potentially-long URL. If the URL is a signed Supabase URL with a query string of several hundred chars, this could be noisy in the console. Consider stripping query params (`new URL(url).pathname`) for readability. Not blocking.

- **`packages/core/src/__tests__/hooks/Avatar.test.ts:225–269`** ("does NOT warn when GLTF has animation clips"): This test is valuable but slightly over-fit — it only asserts that no warn containing `[Avatar]` is emitted. That's fine, but a stronger assertion would verify `onAnimationsReady` was called with a non-null AvatarAnimationState. The test doesn't verify that the populated-animation branch actually produces a usable animation state. Low priority.

- **`packages/core/src/__tests__/hooks/Avatar.test.ts:35–38`**: The `vi.hoisted` comment block is well-written and necessary — no change needed, just noting the authoring cost is justified by the module-singleton caching pattern in Avatar.tsx:429.

- **`tasks/implementation-notes.md`**: Notes are present and describe the three key decisions (walk→idle rationale, console.warn location, vi.hoisted test pattern). However, no explicit note captures that the **primary** diagnosis scenario (zero-clip GLB) is NOT code-fixed by this change — only diagnosed. A reader of the PR could mistakenly believe this commit fixes the reporter's bug. Recommend adding one sentence: "Zero-clip GLB case remains an asset-level fix (replace the GLB); code change only surfaces it to the console."

## What Looks Good

- The root-cause analysis in `bug-diagnosis.md` is thorough (rules out PR #44, traces the two places `localAvatarAnimationRef` is assigned, enumerates four scenarios, narrows on the asset-level cause). The implementer correctly chose hardening + diagnosis over a speculative code fix, which matches diagnosis recommendation #5.
- `switchAnimation`'s fallback is correctly gated on `desiredName === 'walk'` so it cannot accidentally play idle when the caller wants something else.
- The warning string is actionable: includes the URL and a re-export hint. A developer encountering this warning in production can immediately identify the bad asset.
- Warn fires *before* `onAnimationsReady?.(null)` — correct ordering, verified by test.
- The `vi.hoisted` pattern for capturing the module-singleton GLTFLoader instance is a non-obvious but correct solution to the module-init timing problem. It's well-commented.
- setup.ts changes are additive (rotation.set, Box3, clipAction on AnimationMixer) — they broaden mock coverage without changing existing test behaviour.
- Tests cover the important edge case explicitly requested (both walk and idle missing, Avatar.test.ts:93–97).

## Test Coverage

| Area | Tests Exist | Coverage Notes |
|------|-------------|----------------|
| switchAnimation — walk with idle fallback | Yes | 3 tests: plays idle when walk missing; no crash when both missing; fades out previous action before falling back. |
| switchAnimation — normal operation | Yes | 4 tests: walk plays when present; idle plays when present; no restart of already-active action; fade to bind pose when idle missing. |
| loadGLTFIntoGroup — zero-clip warn path | Yes | 1 test verifying warn is emitted with `[Avatar]` prefix and `no animation clips` substring, AND onAnimationsReady called with null. |
| loadGLTFIntoGroup — populated-clip path | Yes | 1 test verifying no `[Avatar]`-prefixed warn. Weaker assertion than ideal — does not verify the positive onAnimationsReady payload. |
| Zero-clip → T-pose end-to-end (ref stays null, avatar visibly T-poses) | No | Not tested, and diagnosis does not require it at code level. Would require a full scene/ref integration test. |

**Test Coverage Assessment**: Tests are meaningful, specific, and cover the edge case the reviewer explicitly asked about. One minor gap (no positive assertion on the populated-clip onAnimationsReady payload) but non-blocking.

## Test Execution

| Check | Result | Details |
|-------|--------|---------|
| Test command discovered | Yes (`pnpm test`) | Root `package.json` `scripts.test` → `pnpm --filter @officexr/core run test` → `vitest run` |
| Test suite run | Passed (231 / 231) | 10 test files, duration 12.04s |
| TDD evidence in implementation notes | Yes | `tasks/implementation-notes.md` line 34: "231/231 tests pass (`pnpm test`)" matches observed count |

**Test Execution Assessment**: All tests pass on the current branch. The pass count in implementation-notes.md matches the observed run. No flakes, no timeouts. Build is in a shippable state.

## Implementation Decision Review

| Task | Decisions Documented | Decisions Sound | Flags |
|------|---------------------|----------------|-------|
| walk→idle fallback | Yes | Yes, with caveat | Semantically correct (idle-while-moving beats T-pose). Narrow scope relative to diagnosis's primary cause — this is a fix for the partial-clip case, not the zero-clip case. Notes don't make that distinction explicit. |
| console.warn placement | Yes | Yes | Correct location (inside the zero-clip branch), correct ordering (before `onAnimationsReady?.(null)`). The decision to skip a secondary warn inside switchAnimation is defensible (URL is the more actionable info). |
| vi.hoisted test pattern | Yes | Yes | Genuinely necessary given the module-singleton `gltfLoader` at Avatar.tsx:429. Well-commented in the test file so future maintainers understand why. |

**Decision Assessment**: Decisions are documented and defensible. The one gap is that implementation-notes.md does not explicitly acknowledge that the primary diagnosis scenario (zero-clip GLB) remains an asset-level fix at the code level — only the console.warn surfaces it. A reader skimming the notes could believe this commit code-fixes the reporter's bug. Recommend adding a one-line note.

## Recommendations

1. (Optional, low priority) Update `tasks/implementation-notes.md` with one sentence clarifying that the zero-clip-GLB case (diagnosis's primary hypothesis) is surfaced by the `console.warn` but still requires an asset-level fix — the code change does not resolve it. This prevents future confusion.
2. (Optional, cosmetic) Strip query params from the warning URL for readability if asset URLs include long signed-URL tokens.
3. (Optional) Strengthen the "does NOT warn when GLTF has animation clips" test to also assert that `onAnimationsReady` was called with a non-null state containing the expected `actions` map keys.
4. Ship as-is if the above are not actioned — the change is net-positive and has no regressions.

## Files Reviewed

- `/home/user/officexr/packages/core/src/components/Avatar.tsx`
- `/home/user/officexr/packages/core/src/__tests__/hooks/Avatar.test.ts`
- `/home/user/officexr/packages/core/src/__tests__/setup.ts`
- `/home/user/officexr/packages/core/src/hooks/useKeyboardControls.ts` (verified the guard at line 427)
- `/home/user/officexr/packages/core/src/hooks/useSceneSetup.ts` (verified ref assignment at line 247)
- `/home/user/officexr/tasks/bug-diagnosis.md`
- `/home/user/officexr/tasks/implementation-notes.md`
