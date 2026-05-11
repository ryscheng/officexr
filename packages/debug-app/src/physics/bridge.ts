import type { Bus, GameEvent } from '@officexr/sdk';
import type { ColliderTag } from './groups.ts';

type Vec2 = { x: number; z: number };

/**
 * Translate a single Rapier body↔body collision into a
 * `collision:char-bump` event pair.
 *
 * Proximity sensor events (`proximity:entering / entered / exiting /
 * exited`) are NOT emitted here any more — those are now driven by the
 * MeetingArea-aware position tracker in
 * `renderer/proximity/pairTracker.ts`, which is the single source of
 * truth for conversation lifecycle. The Rapier inner/outer-sensor
 * BallColliders in `Players.tsx` still exist (they're cheap) but
 * nothing routes their events through this bridge.
 */
export function routeContactEvent(
  busEmit: Bus['emit'],
  _selfId: string,
  a: ColliderTag,
  b: ColliderTag,
  started: boolean,
  /** Contact normal (only meaningful for body↔body). The "from a to b"
   * direction. */
  normalAB?: Vec2,
): void {
  // Only body↔body contacts produce bus events now.
  if (a.kind !== 'body' || b.kind !== 'body') return;
  if (!started) return; // only the "entered" edge matters for bumps
  if (!a.ownerId || !b.ownerId) return;
  if (a.ownerId === b.ownerId) return; // shouldn't happen

  const n = normalAB ?? { x: 0, z: 0 };
  // Bilateral: each participant gets a bump event with the inward
  // normal from their perspective. The original rule emitted both;
  // we match that so the renderer's per-player bump easing fires
  // on both characters.
  busEmit({
    kind: 'collision:char-bump',
    selfId: a.ownerId,
    otherId: b.ownerId,
    normal: { x: -n.x, z: -n.z },
  } as GameEvent);
  busEmit({
    kind: 'collision:char-bump',
    selfId: b.ownerId,
    otherId: a.ownerId,
    normal: { x: n.x, z: n.z },
  } as GameEvent);
}
