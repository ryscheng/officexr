import { loginOf } from '../realtime/player-id.ts';
import type { OfficeState, PlayerId } from './types.ts';

export interface FrozenClaimant {
  login: string;
  deskId: string;
  /** The login's local part, since no per-login display name is stored. */
  name: string;
  characterId?: string;
  claimedAt?: string;
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

/** Who sits on `instanceId`, leaving out `except`. */
export function seatOccupant(
  state: Pick<OfficeState, 'players'>,
  instanceId: string,
  except?: PlayerId,
): PlayerId | null {
  return Object.values(state.players).find((p) => p.seat === instanceId && p.id !== except)?.id ?? null;
}
