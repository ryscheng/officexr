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
  const others = Object.values(s.players).filter(
    (p) => p.id !== selfId && voiceZoneAt(s.voiceZones, p.pos)?.id === zone.id,
  );
  return {
    type: 'inside',
    zoneId: zone.id,
    canEnter: isStill(self) && others.some(isStill),
    canStay: others.length > 0,
  };
}

/** A primitive key per distinct presence, so store subscriptions fire only on a real change. */
export function zonePresenceKey(p: ZonePresence): string {
  return p.type === 'outside' ? 'outside' : `${p.zoneId}|${p.canEnter}|${p.canStay}`;
}

/** Players standing in a desk zone. Their calls are the desk zone's alone, so proximity never pairs them. */
export function playersInDeskZones(s: OfficeState): Set<PlayerId> {
  const ids = new Set<PlayerId>();
  if (s.deskAreas.length === 0) {
    return ids;
  }
  const deskIds = new Set(s.deskAreas.map((a) => a.id));
  for (const p of Object.values(s.players)) {
    const zone = voiceZoneAt(s.voiceZones, p.pos);
    if (zone && deskIds.has(zone.id)) {
      ids.add(p.id);
    }
  }
  return ids;
}
