import type { OfficeState, PlayerId } from './types.ts';

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
