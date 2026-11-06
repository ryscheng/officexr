import { deskAreaAt, deskOwnedBy, loginOf, type OfficeState } from '@officexr/sdk';

export type DeskBanner =
  | { type: 'claimable'; deskId: string; ownsOther: boolean }
  | { type: 'mine' }
  | { type: 'taken'; owner: string };

/** What to say about the desk area the self player stands in; null outside every area. */
export function selectDeskBanner(s: OfficeState): DeskBanner | null {
  const pos = s.players[s.selfId]?.pos;
  const area = pos ? deskAreaAt(s.deskAreas, pos) : null;
  if (!area) {
    return null;
  }
  const login = loginOf(s.selfId);
  const owner = s.deskClaims[area.id];
  if (owner === undefined) {
    return { type: 'claimable', deskId: area.id, ownsOther: deskOwnedBy(s, login) !== null };
  }
  if (owner === login) {
    return { type: 'mine' };
  }
  const online = Object.values(s.players).find((p) => loginOf(p.id) === owner);
  return { type: 'taken', owner: online?.name ?? owner };
}

export const sameDeskBanner = (a: DeskBanner | null, b: DeskBanner | null) => JSON.stringify(a) === JSON.stringify(b);

export const selectOwnsDesk = (s: OfficeState) => deskOwnedBy(s, loginOf(s.selfId)) !== null;
