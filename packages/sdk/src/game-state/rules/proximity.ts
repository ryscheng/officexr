import type { Rule } from '../rules.ts';
import type { Vec3 } from '../types.ts';

export const BUBBLE_RADIUS = 3;

function distXZ(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export const proximityRule: Rule = (state, prev, bus) => {
  const self = state.players[state.selfId];
  if (!self) return;

  const prevSet = prev.proximity[state.selfId] ?? new Set<string>();
  const nextIds = new Set<string>();

  for (const [id, other] of Object.entries(state.players)) {
    if (id === state.selfId) continue;
    if (other.status === 'inactive') continue;
    if (distXZ(self.pos, other.pos) < BUBBLE_RADIUS) {
      nextIds.add(id);
    }
  }

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
