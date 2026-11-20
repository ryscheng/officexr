import { useMemo } from 'react';
import { loginOf, type OfficeState, type Store } from '@officexr/sdk';
import { useStoreSelector } from '@officexr/world/top-down';
import { quantise } from '../quantise';
import { sameList } from '../sameFields';
import { placeAreas, type PlaceAreas, type Spot } from './missionRows';

export type OfficePerson = { id: string; login: string; name: string; x: number; z: number };

const selectSelf = (s: OfficeState): Spot | null => {
  const pos = s.players[s.selfId]?.pos;
  return pos ? { x: quantise(pos.x, 1), z: quantise(pos.z, 1) } : null;
};
const sameSpot = (a: Spot | null, b: Spot | null) => (a && b ? a.x === b.x && a.z === b.z : a === b);

const selectZones = (s: OfficeState) => s.voiceZones;
const selectDesks = (s: OfficeState) => s.deskAreas;

const selectPeople = (s: OfficeState): OfficePerson[] =>
  Object.values(s.players)
    .filter((p) => p.id !== s.selfId && p.name.trim())
    .map((p) => ({ id: p.id, login: loginOf(p.id), name: p.name, x: quantise(p.pos.x, 0.5), z: quantise(p.pos.z, 0.5) }));

/** Where you stand, the office's rooms and desks, and who else is here. */
export function useOfficeSpots(store: Store): { self: Spot | null; areas: PlaceAreas; people: OfficePerson[] } {
  const self = useStoreSelector(store, selectSelf, sameSpot);
  const zones = useStoreSelector(store, selectZones);
  const deskAreas = useStoreSelector(store, selectDesks);
  const people = useStoreSelector(store, selectPeople, sameList);
  const areas = useMemo(() => placeAreas(zones, deskAreas), [zones, deskAreas]);
  return { self, areas, people };
}
