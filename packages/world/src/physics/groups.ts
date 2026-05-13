/**
 * Rapier interaction groups for the debug-app's collision/sensor
 * topology. Rapier represents the (membership, filter) bitmask pair as
 * a single `u32`: the top 16 bits are membership ("which groups am I
 * in?"), the bottom 16 bits are filter ("which groups do I interact
 * with?"). Two colliders interact iff each side's membership intersects
 * the other side's filter.
 *
 * We map the four kinds of collider we have to four bitmask groups:
 *   - BODY: a character's solid body (radius ~ charRadius).
 *   - WALL: static obstacles — floor-edge walls today, future
 *           non-walkable cubes from `worldMap.layers`.
 *   - INNER_SENSOR: the inner proximity ring (drives `proximity:entered`).
 *   - OUTER_SENSOR: the outer proximity ring (drives `proximity:entering`).
 *
 * Behaviour we want:
 *   - BODY ↔ BODY: physical collision (push/slide, `collision:char-bump`).
 *   - BODY ↔ WALL: physical collision (stops at the edge).
 *   - BODY ↔ INNER_SENSOR: sensor intersection (`proximity:entered/exiting`).
 *   - BODY ↔ OUTER_SENSOR: sensor intersection (`proximity:entering/exited`).
 *   - INNER_SENSOR ↔ INNER_SENSOR / OUTER_SENSOR / WALL: nothing.
 *   - WALL ↔ WALL: nothing.
 */
const BODY = 1 << 0;
const WALL = 1 << 1;
const INNER = 1 << 2;
const OUTER = 1 << 3;

/** Build a Rapier interaction-group `u32` from (membership, filter). */
function pack(membership: number, filter: number): number {
  return (membership << 16) | (filter & 0xffff);
}

/** Character body: lives in BODY, interacts with BODY + WALL + both sensors. */
export const BODY_GROUPS = pack(BODY, BODY | WALL | INNER | OUTER);

/** Static wall / obstacle: lives in WALL, interacts only with BODY. */
export const WALL_GROUPS = pack(WALL, BODY);

/** Inner proximity sensor: lives in INNER, intersects only with foreign BODY. */
export const INNER_SENSOR_GROUPS = pack(INNER, BODY);

/** Outer proximity sensor: lives in OUTER, intersects only with foreign BODY. */
export const OUTER_SENSOR_GROUPS = pack(OUTER, BODY);

/** Tag we stash on each collider's `userData` so the bridge knows what
 * kind it is when emitting bus events. The `ownerId` lets the bridge
 * pair Rapier events back to player ids. */
export type ColliderKind = 'body' | 'wall' | 'inner-sensor' | 'outer-sensor';

export interface ColliderTag {
  kind: ColliderKind;
  /** PlayerId for body/sensor colliders; undefined for static walls. */
  ownerId?: string;
}

/** Read the `ColliderTag` we attached to a Rapier collider's `userData`.
 * Returns `null` if the collider isn't tagged (e.g. a third-party
 * collider injected by the renderer). */
export function colliderTag(
  collider: { userData?: unknown } | null | undefined,
): ColliderTag | null {
  if (!collider) return null;
  // Rapier's Collider exposes `userData` as `unknown`. We previously
  // wrote a `ColliderTag` into it via the BallCollider ref, so cast +
  // shape-check here before trusting it.
  const u = (collider as { userData?: unknown }).userData;
  if (!u || typeof u !== 'object') return null;
  const kind = (u as { kind?: unknown }).kind;
  if (
    kind === 'body' ||
    kind === 'wall' ||
    kind === 'inner-sensor' ||
    kind === 'outer-sensor'
  ) {
    return {
      kind,
      ownerId: (u as { ownerId?: string }).ownerId,
    };
  }
  return null;
}
