/**
 * Cube-kind registry façade.
 *
 * As of the Task 3 catalog migration, the authoritative source of truth
 * lives in `packages/world/cube-kinds.json`, hydrated into memory by
 * `cube-catalog.ts`. This file is kept as a thin back-compat facade so
 * callers that imported `CUBE_KINDS` / `getCubeKind` keep working:
 *
 *   - `CUBE_KINDS` is a SNAPSHOT of the bundled-default kinds taken at
 *     module load. Static callers (preload loops, Leva dropdown options
 *     captured at module init) keep seeing the same list they always
 *     did. Live edits made via the Object editor do NOT propagate to
 *     this snapshot — callers that need live data must subscribe via
 *     `useCubeCatalog()`.
 *
 *   - `getCubeKind(id)` reads the LIVE catalog, so dynamic lookups
 *     from runtime code pick up edits without a reload.
 *
 *   - The `CubeKindDef` type is now an alias for `CubeKindEntry` (the
 *     extended shape with material override fields). Old `CubeKindDef`
 *     consumers only read `id`/`label`/`gltfPath`/`swatch`/`walkable`
 *     and ignore the rest, which the widened type permits.
 *
 * Once the studio rename (Task 5/6) is in, the call sites switch to
 * `useCubeCatalog()` directly and this facade can shrink to just the
 * `UNKNOWN_KIND_SWATCH` constant.
 */

import { getKind, listKinds } from './object-kind-catalog.ts';
import type { WorldObjectKind } from './world-object-kinds-schema.ts';

/** @deprecated Use `WorldObjectKind` from `world-object-kinds-schema.ts`. */
export type CubeKindDef = WorldObjectKind;

/** Snapshot of the bundled default kinds taken at module load. Live
 * edits from the Object editor do not flow into this constant — use
 * `useObjectKindCatalog()` for reactive consumption. */
export const CUBE_KINDS: readonly WorldObjectKind[] = listKinds();

export function getCubeKind(id: string): WorldObjectKind | undefined {
  return getKind(id);
}

/**
 * Swatch color for an unknown kind id, so the Inspector / palette can
 * render something even when a scene references a kind that's been
 * renamed or removed.
 */
export const UNKNOWN_KIND_SWATCH = '#71717a';
