import type { EventRule } from '../rules.ts';
import { CHARACTER_BODY } from '../../collision/materials.ts';

/**
 * Translates body-vs-body `collision:entered` events from the per-tick
 * collision pass into the bilateral cosmetic `collision:char-bump` pair
 * the renderer consumes.
 *
 * The pass already does the spatial query, the rising-edge detection, and
 * the contact normal — we just hand the event off to both participants'
 * render-side bump animations. No state writes; no spatial work here.
 */
export const collisionBumpRule: EventRule = {
  kind: 'event',
  pair: [CHARACTER_BODY, CHARACTER_BODY],
  on: ['collision:entered'],
  fn: (event, _state, bus) => {
    if (event.kind !== 'collision:entered') return;
    const a = event.a.ownerId;
    const b = event.b.ownerId;
    if (!a || !b) return;
    const { x: nx, z: nz } = event.normal;
    bus.emit({
      kind: 'collision:char-bump',
      selfId: a,
      otherId: b,
      normal: { x: nx, z: nz },
    });
    bus.emit({
      kind: 'collision:char-bump',
      selfId: b,
      otherId: a,
      normal: { x: -nx, z: -nz },
    });
  },
};
