/**
 * Materials describe what a collision shape *is*. The {@link CollisionMatrix}
 * declares how each pair of materials interacts:
 *
 *   - `'collide'`: physically resolves (used by `resolveMovement` for push-out).
 *   - `'trigger'`: emits enter/exit events but doesn't physically resolve
 *                  (used by proximity sensors).
 *   - `'ignore'`: pair isn't tested at all.
 *
 * Material ids are strings; namespacing via dots is the convention
 * (`'character.body'`, `'cube.wall'`, `'pickup.coin'`). Apps extend by
 * passing a custom matrix when they construct the rule registry.
 */
export type MaterialId = string;

export type Interaction = 'collide' | 'trigger' | 'ignore';

/**
 * Sparse map of `materialA → materialB → Interaction`. Lookup via
 * {@link interactionFor} which is symmetric: `(a, b)` and `(b, a)` return
 * the same value, so callers don't have to choose an order.
 *
 * Missing entries fall back to `'ignore'` — declaring a material doesn't
 * implicitly opt it into collisions.
 */
export type CollisionMatrix = Record<MaterialId, Record<MaterialId, Interaction>>;

/** Built-in materials shipped by the SDK. */
export const CHARACTER_BODY = 'character.body';
/** Inner proximity sensor — voice-room-on / steady-glow boundary. */
export const CHARACTER_PROXIMITY_INNER = 'character.proximity.inner';
/** Outer proximity sensor — visual approach band, voice-room hysteresis. */
export const CHARACTER_PROXIMITY_OUTER = 'character.proximity.outer';
export const CUBE_WALL = 'cube.wall';
export const CUBE_WALKABLE = 'cube.walkable';

/**
 * Default collision behaviour for the built-in materials. Symmetric — both
 * directions of every pair are populated so {@link interactionFor} can do a
 * single lookup without a swap.
 *
 *   body × body                 → collide  (bodies push each other)
 *   body × proximity.inner      → trigger  (fires entered/exiting)
 *   body × proximity.outer      → trigger  (fires entering/exited)
 *   body × cube.wall            → collide
 *   body × cube.walkable        → ignore
 *   proximity.* × proximity.*   → ignore   (sensors don't see each other)
 *   proximity.* × cube.*        → ignore
 *   cube.* × cube.*             → ignore
 */
export const DEFAULT_COLLISION_MATRIX: CollisionMatrix = pairs([
  [CHARACTER_BODY, CHARACTER_BODY, 'collide'],
  [CHARACTER_BODY, CHARACTER_PROXIMITY_INNER, 'trigger'],
  [CHARACTER_BODY, CHARACTER_PROXIMITY_OUTER, 'trigger'],
  [CHARACTER_BODY, CUBE_WALL, 'collide'],
  [CHARACTER_BODY, CUBE_WALKABLE, 'ignore'],
  [CHARACTER_PROXIMITY_INNER, CHARACTER_PROXIMITY_INNER, 'ignore'],
  [CHARACTER_PROXIMITY_INNER, CHARACTER_PROXIMITY_OUTER, 'ignore'],
  [CHARACTER_PROXIMITY_INNER, CUBE_WALL, 'ignore'],
  [CHARACTER_PROXIMITY_INNER, CUBE_WALKABLE, 'ignore'],
  [CHARACTER_PROXIMITY_OUTER, CHARACTER_PROXIMITY_OUTER, 'ignore'],
  [CHARACTER_PROXIMITY_OUTER, CUBE_WALL, 'ignore'],
  [CHARACTER_PROXIMITY_OUTER, CUBE_WALKABLE, 'ignore'],
  [CUBE_WALL, CUBE_WALL, 'ignore'],
  [CUBE_WALL, CUBE_WALKABLE, 'ignore'],
  [CUBE_WALKABLE, CUBE_WALKABLE, 'ignore'],
]);

/**
 * Return the interaction defined between two materials, or `'ignore'` if
 * the pair isn't in the matrix. Symmetric — order of arguments doesn't
 * matter; the matrix is populated both ways by {@link pairs}.
 */
export function interactionFor(
  matrix: CollisionMatrix,
  a: MaterialId,
  b: MaterialId,
): Interaction {
  return matrix[a]?.[b] ?? matrix[b]?.[a] ?? 'ignore';
}

/** Build a symmetric matrix from a list of unordered triples. */
function pairs(
  entries: ReadonlyArray<readonly [MaterialId, MaterialId, Interaction]>,
): CollisionMatrix {
  const out: CollisionMatrix = {};
  for (const [a, b, k] of entries) {
    if (!out[a]) out[a] = {};
    if (!out[b]) out[b] = {};
    out[a][b] = k;
    out[b][a] = k;
  }
  return out;
}

/**
 * Merge an extension matrix on top of the defaults. Useful when an app
 * wants to add new materials without redeclaring the built-ins.
 */
export function mergeMatrix(
  base: CollisionMatrix,
  extension: CollisionMatrix,
): CollisionMatrix {
  const out: CollisionMatrix = {};
  for (const a in base) out[a] = { ...base[a] };
  for (const a in extension) {
    out[a] = { ...(out[a] ?? {}), ...extension[a] };
  }
  return out;
}
