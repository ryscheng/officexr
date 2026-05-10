import type { OfficeState, PlayerId } from '../game-state/types.ts';
import {
  CHARACTER_BODY,
  CHARACTER_PROXIMITY_INNER,
  CHARACTER_PROXIMITY_OUTER,
  type MaterialId,
} from './materials.ts';
import type { Vec2 } from './types.ts';

/**
 * A collidable shape. The collision pass treats every shape as a circle in
 * XZ — narrow phase against cubes can refine to AABB-vs-circle later.
 *
 * `id` is stable across ticks for a given anchor (the player id, the cell
 * coordinates) so the pass can match shapes to their previous state and
 * compute enter/exit edges.
 */
export interface Shape {
  id: string;
  /** Back-link to a player when applicable (body / proximity sensor). */
  ownerId?: PlayerId;
  material: MaterialId;
  pos: Vec2;
  radius: number;
}

/**
 * Build the set of player-anchored shapes for a tick.
 *
 * Returns three shapes per active player: a body, an inner proximity
 * sensor (`proximityRadius`), and an outer proximity sensor
 * (`proximityOuterRadius`). The two sensor materials let the proximity
 * rules disambiguate which boundary was crossed without consulting shape
 * ids — the matrix says both materials trigger against `body`, the rules
 * subscribe to one each.
 *
 * Cubes are NOT included — they live in the existing {@link CollisionWorld}
 * spatial grid which the pass queries directly via `forEachCellInRadius`.
 */
export function derivePlayerShapes(state: OfficeState): Shape[] {
  const { charRadius, proximityRadius, proximityOuterRadius } =
    state.worldSettings;
  const out: Shape[] = [];
  for (const id in state.players) {
    const p = state.players[id];
    if (p.status === 'inactive') continue;
    out.push({
      id: bodyShapeId(id),
      ownerId: id,
      material: CHARACTER_BODY,
      pos: { x: p.pos.x, z: p.pos.z },
      radius: charRadius,
    });
    out.push({
      id: innerProximityShapeId(id),
      ownerId: id,
      material: CHARACTER_PROXIMITY_INNER,
      pos: { x: p.pos.x, z: p.pos.z },
      radius: proximityRadius,
    });
    out.push({
      id: outerProximityShapeId(id),
      ownerId: id,
      material: CHARACTER_PROXIMITY_OUTER,
      pos: { x: p.pos.x, z: p.pos.z },
      radius: proximityOuterRadius,
    });
  }
  return out;
}

export function bodyShapeId(playerId: PlayerId): string {
  return `player:${playerId}:body`;
}

export function innerProximityShapeId(playerId: PlayerId): string {
  return `player:${playerId}:proximity-inner`;
}

export function outerProximityShapeId(playerId: PlayerId): string {
  return `player:${playerId}:proximity-outer`;
}
