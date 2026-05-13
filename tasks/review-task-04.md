# Code Review — Task 4 (Studio Asset Packs)

## Summary

Ships clean. Spec is met end-to-end: the install CLI downloads/unzips/enumerates/registers the three KayKit FREE packs, the gitignore covers only the binary-bearing subdirs (blocks remain committed), the catalog has 281 entries (12 + 53 + 72 + 144) with unique ids, allowed categories, `/models/`-rooted paths, and "no-change" override defaults across the board. All 99 tests pass, typecheck is clean, and no `three`/`react` leakage into the script. A handful of minor improvements below; nothing blocks the commit.

## Spec compliance

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | Script downloads + unzips three packs into `packages/studio/public/models/{furniture,prototype,restaurant}/` | Complete | `download-asset-packs.ts:80-98` — fetch + `unzip -o -q` |
| 2 | Enumerates `.gltf` files and appends entries with correct category | Complete | `:100-114` walker + `:133-155` entry generator; per-category counts 53/72/144 match disk |
| 3 | `pnpm asset-packs:install` alias at root + workspace | Complete | `package.json:31`, `packages/world/package.json:21` |
| 4 | `>5 MB` total → gitignored, only binaries (not catalog) | Complete | ~39 MB on disk; `.gitignore:56-61` ignores the three binary dirs; `cube-kinds.json` committed; `blocks/` not ignored (verified via `git check-ignore`) |
| 5 | Idempotent — re-run is a no-op; `--force` opt-in | Mostly complete | Dedup works (`existingIds` + `dirHasFiles`). Minor: `updatedAt` is rewritten every run — see Minor below |
| 6 | Catalog shape test (required fields + category from allowed set) | Complete | `cube-kinds-json.test.ts` has 7 invariants on committed catalog + bundled default |
| 7 | AGENTS.md documents the install step | Complete | `AGENTS.md:243-262` adds a "Studio Asset Packs" section |

Compliance: 7/7 (one Minor on the idempotency edge).

## Issues Found

### Critical

None.

### Important

None.

### Minor

- **`packages/world/scripts/download-asset-packs.ts:188`**: `catalog.updatedAt = Date.now()` runs unconditionally, even when `added === 0`. A no-op second run rewrites `cube-kinds.json` with a new timestamp, producing a spurious git diff. Gate this with `if (added > 0)`.
- **`packages/world/scripts/download-asset-packs.ts:116-122` (slug derivation)**: `slugify()` lowercases after stripping non-alnum, so two files differing only in case (e.g. `Chair_A.gltf` and `chair_a.gltf`) within the *same* pack would map to the same id. Current packs don't trigger this (verified — no within-pack case-collisions), but a future pack drop could; the dedup at `:182` would silently drop one entry while leaving its binary on disk. Either include a case-preserving hash in the id or warn on first-collision detection.
- **`packages/world/src/scenes/cube-kinds-json.test.ts`**: No assertion that `gltfPath` ends in `.gltf` or that override defaults match the spec'd "no-change" baseline (scale=1, opacity=1, tint=null, emissiveIntensity=0). The script writes them correctly today, but a regression that flipped `scale: 1` to `scale: 0` (invisible objects) would not be caught. Add a per-entry default-value assertion for newly-added (non-block) categories.
- **`packages/world/scripts/download-asset-packs.ts:96`**: `execSync('unzip ...')` with no try/catch. On a machine without `unzip`, the user gets a generic spawn error from the top-level `.catch`. The header comment (`:17-18`) documents the dep, but a preflight `which unzip` check with a friendly Windows-without-WSL hint would be a small UX win.
- **`packages/world/scripts/download-asset-packs.ts:124-131` (humanize)**: `.replace(/\s+/g, ' ')` is dead code — the previous `[_-]+` replacement already collapses runs to a single space. Cosmetic.

## What looks good

- Script structure mirrors `migrate-scenes-to-rooms.ts` exactly (shebang, `__dirname` via `fileURLToPath`, `.ts` source imports, top-level `main().catch`) — convention-consistent.
- Reuses `validateCubeKindCatalog` to round-trip the parsed catalog instead of trusting raw JSON (`:159`). This means a manually-corrupted `cube-kinds.json` is caught on read, not silently re-serialized.
- `entryForGltf` uses `relative(STUDIO_PUBLIC, …)` plus a `\\ → /` normalization so the produced `gltfPath` is Windows-safe. Path-traversal is structurally impossible given `findGltfs` only walks under `MODELS_DIR`.
- `.gitignore` ignores only the three binary dirs by name, leaving `packages/studio/public/models/blocks/` (committed BlockBits) untouched. Verified with `git check-ignore`.
- AGENTS.md call-out explicitly tells future devs why `useGLTF` 404s in the un-installed state and that the default 12 blocks still work — a real bear trap to dodge in onboarding.
- No `three`/`react`/SDK-layering violations. DIP greps remain clean.
- Test file naming + colocation (`src/scenes/cube-kinds-json.test.ts`) matches the rest of the package.

## Test coverage

| Area | Tests exist | Notes |
|---|---|---|
| Committed catalog passes validator | Yes | `:23` |
| Bundled defaults preserved in committed catalog | Yes | `:27` (catches accidental block removal) |
| Unique ids | Yes | `:36` (direct collision check, not a `Set.size` shortcut — preserves the duplicate list for the error message) |
| Categories within allowed set | Yes | `:48` |
| `gltfPath` rooted at `/models/` | Yes | `:59` |
| Bundled default has exactly 12 block entries | Yes | `:75` |
| Override defaults match "no-change" baseline | **No** | See Minor — would catch a scale=0 / opacity=0 regression |
| `gltfPath` ends in `.gltf` | **No** | See Minor — would catch a `.bin`/`.txt` regression |

Tests pass without running the installer (only structural invariants, no fs/binary deps), which matches the stated CI constraint.

## Test execution

| Check | Result |
|---|---|
| Test command | `pnpm --filter @officexr/world test` |
| Suite | Passed (99/99 across 10 files, +7 new in `cube-kinds-json.test.ts`) |
| Typecheck | Clean |
| DIP greps (`three`/`react` in sdk/realtime-server/core-refactor) | Clean |
| Gitignore behavior | `git check-ignore` confirms the three binary dirs ignored, `blocks/` not ignored |
| Catalog data scan | 281 kinds, 0 duplicate ids, 0 paths containing `..`, 0 paths not under `/models/`, 0 entries with non-default scale/opacity/emissiveIntensity |

## Implementation Decision Review

No `tasks/implementation-notes.md` was written for this task. Decisions are inferable from comments in the script header and from `AGENTS.md`. The non-obvious choices (system `unzip` over a Node-native unzipper, dedup-by-id during merge rather than wipe-and-regenerate, gitignore the binaries but commit the catalog) are all justified by the file-header comment block at `download-asset-packs.ts:1-19` and the AGENTS.md section. For a task this self-contained that's adequate; no flag.

## Recommendations (priority order)

1. Gate `catalog.updatedAt = Date.now()` on `added > 0` to make idempotent re-runs truly no-op on the working tree.
2. Add two test assertions in `cube-kinds-json.test.ts`: (a) every entry's `gltfPath` ends in `.gltf`, (b) every non-block entry's scale/opacity/emissiveIntensity match the no-change defaults.
3. Optionally: preflight `which unzip` in the script and print a Windows-specific hint on failure.
4. Optionally: detect case-collision slug clashes within a pack at install time and warn — defensive against future pack drops.
