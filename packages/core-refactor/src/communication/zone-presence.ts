import { voiceZoneAt, type OfficeState, type PlayerId, type PlayerState } from '@officexr/sdk';

/**
 * Where the local player stands relative to the voice zones, and whether its
 * call may start (after the dwell) or carry on.
 */
export type ZonePresence =
  | { type: 'outside' }
  | { type: 'inside'; zoneId: string; canEnter: boolean; canStay: boolean };

/** Horizontal speed (m/s) below which a player counts as stopped. */
const STILL_SPEED = 0.05;

const isStill = (p: Pick<PlayerState, 'vel' | 'isAirborne'>): boolean =>
  !p.isAirborne && Math.hypot(p.vel.x, p.vel.z) < STILL_SPEED;

type Rect = { min: { x: number; z: number }; max: { x: number; z: number } };

const inRect = (r: Rect, pos: { x: number; z: number }): boolean =>
  pos.x >= r.min.x && pos.x <= r.max.x && pos.z >= r.min.z && pos.z <= r.max.z;

/**
 * Room zones open their call to anyone inside. A desk zone's call needs
 * company: it starts only while the local player and at least one other player
 * are both stopped inside it, so walking, running or jumping through never
 * joins, and it lasts while anyone else remains inside.
 */
export function zonePresence(s: OfficeState, selfId: PlayerId): ZonePresence {
  const self = s.players[selfId];
  const zone = self ? voiceZoneAt(s.voiceZones, self.pos) : null;
  if (!self || !zone) {
    return { type: 'outside' };
  }
  if (!s.deskAreas.some((a) => a.id === zone.id)) {
    return { type: 'inside', zoneId: zone.id, canEnter: true, canStay: true };
  }
  let canStay = false;
  let anyStill = false;
  for (const id in s.players) {
    const p = s.players[id];
    if (id === selfId || !inRect(zone, p.pos) || voiceZoneAt(s.voiceZones, p.pos) !== zone) {
      continue;
    }
    canStay = true;
    anyStill ||= isStill(p);
  }
  return { type: 'inside', zoneId: zone.id, canEnter: anyStill && isStill(self), canStay };
}

/** A primitive key per distinct presence, so store subscriptions fire only on a real change. */
export function zonePresenceKey(p: ZonePresence): string {
  return p.type === 'outside' ? 'outside' : `${p.zoneId}|${p.canEnter}|${p.canStay}`;
}
