import type { OfficeState, PlayerId } from '../game-state/types.ts';
import { PlayerGrid } from '../spatial/player-grid.ts';
import {
  type CollisionMatrix,
  type Interaction,
  type MaterialId,
  CHARACTER_BODY,
  CHARACTER_PROXIMITY_INNER,
  CHARACTER_PROXIMITY_OUTER,
  interactionFor,
} from './materials.ts';
import { derivePlayerShapes, type Shape } from './shapes.ts';
import type { Vec2 } from './types.ts';

/**
 * Reference to a shape carried by collision events — just the bits a rule
 * usually needs (id, the player who owns it if any, and the material).
 */
export interface ShapeRef {
  id: string;
  ownerId?: PlayerId;
  material: MaterialId;
}

export type CollisionEvent =
  | {
      kind: 'collision:entered';
      a: ShapeRef;
      b: ShapeRef;
      interaction: 'collide' | 'trigger';
      /** Unit XZ normal pointing from b → a, useful for bump effects. */
      normal: Vec2;
    }
  | {
      kind: 'collision:exited';
      a: ShapeRef;
      b: ShapeRef;
      interaction: 'collide' | 'trigger';
    };

/**
 * Run the per-tick collision pass over broadcast state.
 *
 * Iterates unique unordered shape pairs whose materials interact (per
 * `matrix`). For each pair we check the overlap state in `state` vs `prev`:
 *
 *   - was-not, is-now → emit `collision:entered`
 *   - was, is-not    → emit `collision:exited`
 *   - both / neither → no event
 *
 * Both endpoints of a pair come from the same broadcast state, so two
 * peers running this pass on the same `(state, prev)` produce identical
 * event sequences. That's the determinism guarantee that makes the bus
 * events safe to drive observable behaviour from.
 *
 * Today we only emit player-anchored events (body/proximity); cube
 * collision events would be straightforward to add but no rule consumes
 * them yet.
 */
export function runCollisionPass(
  state: OfficeState,
  prev: OfficeState,
  matrix: CollisionMatrix,
): CollisionEvent[] {
  const shapesNow = derivePlayerShapes(state);
  const shapesPrev = derivePlayerShapes(prev);
  if (shapesNow.length < 2 && shapesPrev.length < 2) return [];

  const prevById = new Map<string, Shape>();
  for (const s of shapesPrev) prevById.set(s.id, s);

  // Cell size = the largest shape radius in play, so a query touches at
  // most a 3×3 block of cells. The OUTER proximity sensor is the largest
  // radius today; sizing the grid to it covers every other shape too.
  const cellSize = state.worldSettings.proximityOuterRadius;
  const grid = new PlayerGrid(cellSize);
  for (const s of shapesNow) grid.insert(s.id, s.pos.x, s.pos.z);

  const shapeById = new Map<string, Shape>();
  for (const s of shapesNow) shapeById.set(s.id, s);

  // Collect unique unordered pairs we need to test, then sort for
  // deterministic event order across clients.
  const pairs: Array<{
    a: Shape;
    b: Shape;
    interaction: Interaction;
  }> = [];
  const seen = new Set<string>();
  // 1) "Now" pairs — every overlap candidate that exists this tick.
  for (const a of shapesNow) {
    grid.forEachInRadius(a.pos.x, a.pos.z, a.radius + maxOtherRadius(a, cellSize), (otherId) => {
      if (otherId === a.id) return;
      const pairKey = a.id < otherId ? `${a.id}|${otherId}` : `${otherId}|${a.id}`;
      if (seen.has(pairKey)) return;
      const b = shapeById.get(otherId);
      if (!b) return;
      const interaction = interactionFor(matrix, a.material, b.material);
      if (interaction === 'ignore') return;
      seen.add(pairKey);
      pairs.push({ a, b, interaction });
    });
  }
  // 2) "Was-overlapping" pairs that may have completely separated this
  //    tick — they wouldn't be picked up by the now-grid, so we have to
  //    scan prevShapes too. Most of the time this finds zero new pairs.
  if (shapesPrev.length >= 2) {
    const prevGrid = new PlayerGrid(cellSize);
    for (const s of shapesPrev) prevGrid.insert(s.id, s.pos.x, s.pos.z);
    for (const a of shapesPrev) {
      prevGrid.forEachInRadius(
        a.pos.x,
        a.pos.z,
        a.radius + maxOtherRadius(a, cellSize),
        (otherId) => {
          if (otherId === a.id) return;
          const pairKey =
            a.id < otherId ? `${a.id}|${otherId}` : `${otherId}|${a.id}`;
          if (seen.has(pairKey)) return;
          const bPrev = prevById.get(otherId);
          if (!bPrev) return;
          const interaction = interactionFor(matrix, a.material, bPrev.material);
          if (interaction === 'ignore') return;
          // Resolve a/b for the (potentially missing) current frame.
          const aNow = shapeById.get(a.id);
          const bNow = shapeById.get(bPrev.id);
          // We only need to register this pair so the loop below can see
          // its prev-overlap and emit `exited`. Use prev shapes as the
          // canonical objects when current is missing.
          seen.add(pairKey);
          pairs.push({
            a: aNow ?? a,
            b: bNow ?? bPrev,
            interaction,
          });
        },
      );
    }
  }

  // Stable order so two clients with the same input produce the same event sequence.
  pairs.sort((p, q) => {
    if (p.a.id < q.a.id) return -1;
    if (p.a.id > q.a.id) return 1;
    if (p.b.id < q.b.id) return -1;
    if (p.b.id > q.b.id) return 1;
    return 0;
  });

  const events: CollisionEvent[] = [];
  for (const { a, b, interaction } of pairs) {
    const aNow = shapeById.get(a.id);
    const bNow = shapeById.get(b.id);
    const aPrev = prevById.get(a.id);
    const bPrev = prevById.get(b.id);
    const isNow = aNow && bNow ? overlap(aNow, bNow) : false;
    const wasPrev = aPrev && bPrev ? overlap(aPrev, bPrev) : false;
    if (isNow && !wasPrev) {
      events.push({
        kind: 'collision:entered',
        a: shapeRef(aNow!),
        b: shapeRef(bNow!),
        interaction: interaction as 'collide' | 'trigger',
        normal: contactNormal(aNow!, bNow!),
      });
    } else if (!isNow && wasPrev) {
      events.push({
        kind: 'collision:exited',
        a: shapeRef(aPrev!),
        b: shapeRef(bPrev!),
        interaction: interaction as 'collide' | 'trigger',
      });
    }
  }
  return events;
}

/** Tolerance added to the overlap radius so the pass classifies "freshly
 * pushed apart by resolveMovement" (where the resolver places shapes at
 * exactly sumR distance, modulo float drift) as overlapping. Without it,
 * two characters that just made contact register as "no overlap" and no
 * `collision:entered` fires for the bump rule. 0.05 m matches the slack
 * the legacy collisionBumpRule used. */
const OVERLAP_SLACK = 0.05;

function overlap(a: Shape, b: Shape): boolean {
  const dx = a.pos.x - b.pos.x;
  const dz = a.pos.z - b.pos.z;
  const r = a.radius + b.radius + OVERLAP_SLACK;
  return dx * dx + dz * dz <= r * r;
}

function contactNormal(a: Shape, b: Shape): Vec2 {
  const dx = a.pos.x - b.pos.x;
  const dz = a.pos.z - b.pos.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return { x: 1, z: 0 };
  return { x: dx / len, z: dz / len };
}

function shapeRef(s: Shape): ShapeRef {
  const ref: ShapeRef = { id: s.id, material: s.material };
  if (s.ownerId !== undefined) ref.ownerId = s.ownerId;
  return ref;
}

/** Largest radius any shape in our setup might bring to a query. We bound
 * by `cellSize` (the proximity sensor radius — the largest in our setup)
 * so the broad-phase reach covers any pair-of-circles overlap candidate. */
function maxOtherRadius(_self: Shape, cellSize: number): number {
  return cellSize;
}

// Re-exports so consumers can do a single import from `@officexr/sdk` for
// pass + materials + shapes if they like.
export {
  CHARACTER_BODY,
  CHARACTER_PROXIMITY_INNER,
  CHARACTER_PROXIMITY_OUTER,
};
