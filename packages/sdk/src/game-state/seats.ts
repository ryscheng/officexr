import type { ClaimantCalendar, ClaimantSlack } from '../realtime/desk-claim.ts';
import { loginOf } from '../realtime/player-id.ts';
import type { OfficeState, PlayerId } from './types.ts';

export interface FrozenClaimant {
  login: string;
  deskId: string;
  /** The login's local part, since no per-login display name is stored. */
  name: string;
  characterId?: string;
  claimedAt?: string;
  calendar?: ClaimantCalendar;
  slack?: ClaimantSlack;
}

/** Claimants of a desk with no live session in the room, by desk id. The self login is never frozen. */
export function frozenClaimants(
  state: Pick<OfficeState, 'deskClaims' | 'deskClaimants' | 'players' | 'selfId'>,
): FrozenClaimant[] {
  const present = new Set(Object.keys(state.players).map(loginOf));
  present.add(loginOf(state.selfId));
  return Object.entries(state.deskClaims)
    .filter(([, login]) => !present.has(login))
    .map(([deskId, login]) => ({
      login,
      deskId,
      name: login.split('@')[0] || login,
      ...state.deskClaimants[login],
    }))
    .sort((a, b) => a.deskId.localeCompare(b.deskId));
}

export function deskOwnedBy(state: Pick<OfficeState, 'deskClaims'>, login: string): string | null {
  return Object.entries(state.deskClaims).find(([, owner]) => owner === login)?.[0] ?? null;
}

const SEAT_INDEX_SEPARATOR = '#';

/** Id of seat `index` on `instanceId`. Seat 0 is the bare instance id, which is what clients that know one seat per instance send. */
export function seatId(instanceId: string, index: number): string {
  return index === 0 ? instanceId : `${instanceId}${SEAT_INDEX_SEPARATOR}${index}`;
}

export function parseSeatId(id: string): { instanceId: string; index: number } {
  const cut = id.lastIndexOf(SEAT_INDEX_SEPARATOR);
  const suffix = cut < 0 ? '' : id.slice(cut + 1);
  return /^[1-9]\d*$/.test(suffix)
    ? { instanceId: id.slice(0, cut), index: Number(suffix) }
    : { instanceId: id, index: 0 };
}

/** Who sits on the seat `id`, leaving out `except`. */
export function seatOccupant(state: Pick<OfficeState, 'players'>, id: string, except?: PlayerId): PlayerId | null {
  return Object.values(state.players).find((p) => p.seat === id && p.id !== except)?.id ?? null;
}
