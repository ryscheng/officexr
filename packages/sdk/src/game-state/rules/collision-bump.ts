import type { Rule } from '../rules.ts';
import { PlayerGrid } from '../../spatial/player-grid.ts';

/** Slack added to the contact distance so the rising-edge fires reliably even
 * if a single frame's overlap was very shallow. */
const SLACK = 0.05;

/**
 * Emits {@link GameEvent} `collision:char-bump` events on the rising edge of
 * a pair of characters crossing into contact distance. One event per
 * participant — both avatars get a render-side bump regardless of which side
 * was the active mover. Pure observation; never writes back to state.
 *
 * Contact threshold is `2 · charRadius + SLACK`. The rule reads from
 * `state.worldSettings.charRadius` so it stays in sync with whatever the
 * collision-resolver is using on the action side. The current-frame query is
 * spatial-hashed so cost grows with local density, not total player count.
 */
export const collisionBumpRule: Rule = (state, prev, bus) => {
  const sumR = 2 * state.worldSettings.charRadius;
  const trigger = sumR + SLACK;
  const trigger2 = trigger * trigger;

  // Cell size = trigger so a query is at most a 3×3 block of cells. We only
  // need pairs whose CURRENT distance is ≤ trigger; the prev-frame distance
  // doesn't need a grid (we read it from prev.players directly).
  const grid = PlayerGrid.fromPlayers(state.players, trigger);
  const seen = new Set<string>();
  for (const idA in state.players) {
    const a = state.players[idA];
    const aPrev = prev.players[idA];
    if (!a || !aPrev) continue;
    grid.forEachInRadius(a.pos.x, a.pos.z, trigger, (idB) => {
      if (idA === idB) return;
      // Visit each unordered pair once.
      const pairKey = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
      if (seen.has(pairKey)) return;
      seen.add(pairKey);
      const b = state.players[idB];
      const bPrev = prev.players[idB];
      if (!b || !bPrev) return;
      const dx = a.pos.x - b.pos.x;
      const dz = a.pos.z - b.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > trigger2) return;
      const pdx = aPrev.pos.x - bPrev.pos.x;
      const pdz = aPrev.pos.z - bPrev.pos.z;
      if (pdx * pdx + pdz * pdz <= trigger2) return; // already in contact last frame
      const len = Math.max(Math.sqrt(d2), 1e-6);
      const nx = dx / len;
      const nz = dz / len;
      bus.emit({
        kind: 'collision:char-bump',
        selfId: idA,
        otherId: idB,
        normal: { x: nx, z: nz },
      });
      bus.emit({
        kind: 'collision:char-bump',
        selfId: idB,
        otherId: idA,
        normal: { x: -nx, z: -nz },
      });
    });
  }
};
