import { useMemo } from 'react';
import { loginOf, type Mission, type OfficeState, type Store } from '@officexr/sdk';
import { useStoreSelector } from '@officexr/world/top-down';
import { quantise } from '../quantise';
import { sameList } from '../sameFields';
import { distancesFrom, missionSpots, placeAreas, sameDistances, type PlaceAreas, type Spot } from './missionRows';

export type OfficePerson = { id: string; login: string; name: string };

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
    .map((p) => ({ id: p.id, login: loginOf(p.id), name: p.name }));

export function useOfficeAreas(store: Store): PlaceAreas {
  const zones = useStoreSelector(store, selectZones);
  const deskAreas = useStoreSelector(store, selectDesks);
  return useMemo(() => placeAreas(zones, deskAreas), [zones, deskAreas]);
}

export function useMissionDistances(store: Store, missions: readonly Mission[], areas: PlaceAreas): ReadonlyMap<string, number> {
  const spots = useMemo(() => missionSpots(missions, areas), [missions, areas]);
  const select = useMemo(() => (s: OfficeState) => distancesFrom(spots, selectSelf(s)), [spots]);
  return useStoreSelector(store, select, sameDistances);
}

export const useSelfSpot = (store: Store): Spot | null => useStoreSelector(store, selectSelf, sameSpot);

export const useOfficePeople = (store: Store): OfficePerson[] => useStoreSelector(store, selectPeople, sameList);

export function useOfficeSpots(store: Store): { self: Spot | null; areas: PlaceAreas; people: OfficePerson[] } {
  return { self: useSelfSpot(store), areas: useOfficeAreas(store), people: useOfficePeople(store) };
}
