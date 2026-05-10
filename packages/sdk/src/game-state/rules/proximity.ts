import type { Rule } from '../rules.ts';
import { PlayerGrid } from '../../spatial/player-grid.ts';

export const BUBBLE_RADIUS = 3;

export const proximityRule: Rule = (state, prev, bus) => {
  const self = state.players[state.selfId];
  if (!self) return;

  const prevSet = prev.proximity[state.selfId] ?? new Set<string>();
  const nextIds = new Set<string>();

  // Spatial hash sized at the proximity radius so a query touches at most a
  // 3×3 block of cells — independent of total player count.
  const grid = PlayerGrid.fromPlayers(state.players, BUBBLE_RADIUS);
  const r2 = BUBBLE_RADIUS * BUBBLE_RADIUS;
  grid.forEachInRadius(self.pos.x, self.pos.z, BUBBLE_RADIUS, (id) => {
    if (id === state.selfId) return;
    const other = state.players[id];
    if (!other || other.status === 'inactive') return;
    const dx = self.pos.x - other.pos.x;
    const dz = self.pos.z - other.pos.z;
    if (dx * dx + dz * dz < r2) nextIds.add(id);
  });

  for (const id of nextIds) {
    if (prevSet.has(id)) {
      bus.emit({ kind: 'proximity:entered', otherId: id });
    } else {
      bus.emit({ kind: 'proximity:entering', otherId: id });
    }
  }
  for (const id of prevSet) {
    if (!nextIds.has(id)) {
      bus.emit({ kind: 'proximity:exiting', otherId: id });
    }
  }
};
