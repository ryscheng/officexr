import type { DepartedPlayer, PlayerState, PresenceStatus } from './types.ts';

export const UNRESPONSIVE_MS = 15_000;
export const AWAY_UNRESPONSIVE_MS = 150_000;
export const DEPARTED_LINGER_MS = 60_000;

export type PresenceIndicator = PresenceStatus | 'unresponsive' | 'offline';

/**
 * Indicator for a remote player. A player with no timestamp (not laid down by
 * a live event or snapshot here) has nothing to age, so it shows its status.
 */
export function presenceIndicator(
  p: PlayerState | Pick<DepartedPlayer, 'leftAt'>,
  now: number,
): PresenceIndicator {
  if ('leftAt' in p) return 'offline';
  const heardAt = p.lastStatusAt ?? p.firstSeenAt;
  const graceMs = p.status === 'away' ? AWAY_UNRESPONSIVE_MS : UNRESPONSIVE_MS;
  return heardAt !== undefined && now - heardAt > graceMs ? 'unresponsive' : p.status;
}
