import type { DepartedPlayer, OfficeState, PlayerId, PlayerState } from '@officexr/sdk';
import { loginOf } from '@officexr/sdk';
import { planarDistance, relativeBearing } from '@officexr/world/top-down';
import { quantise } from './quantise';

export const DEG = 180 / Math.PI;

export type PresencePlayer = Pick<PlayerState, 'id' | 'name' | 'status' | 'lastStatusAt' | 'firstSeenAt'> & {
  /** Null until your own position is known. */
  distanceM: number | null;
  /** Bearing for a view yaw of 0, in degrees rounded to 5°. */
  bearingDeg: number;
};
export type DepartedEntry = DepartedPlayer & { id: PlayerId };

export const toPresencePlayer = (id: PlayerId, p: OfficeState['players'][PlayerId], selfPos?: PlayerState['pos']) => ({
  id,
  name: p.name,
  status: p.status,
  lastStatusAt: p.lastStatusAt,
  firstSeenAt: p.firstSeenAt,
  distanceM: selfPos ? Math.floor(planarDistance(selfPos, p.pos)) : null,
  bearingDeg: selfPos ? quantise(relativeBearing(selfPos, 0, p.pos) * DEG, 5) : 0,
});

/** `entries` must be in join order; windows sharing a login are numbered by it. */
export function labelsInJoinOrder(entries: { id: PlayerId; name: string }[]): Map<PlayerId, string> {
  const seen = new Map<string, number>();
  return new Map(
    entries.map(({ id, name }) => {
      const login = loginOf(id);
      const n = (seen.get(login) ?? 0) + 1;
      seen.set(login, n);
      return [id, name ? `${name}${n > 1 ? ` (${n})` : ''}` : 'Joining…'];
    }),
  );
}
