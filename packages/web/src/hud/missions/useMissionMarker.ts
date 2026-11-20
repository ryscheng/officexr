import { useEffect, useMemo, useReducer } from 'react';
import type { Mission, Store } from '@officexr/sdk';
import type { MissionMarkerTarget } from '@officexr/world/renderer';
import { placeAreas, resolvePlace } from './missionRows';

/** Where the world marker goes for the current mission; null without a placed mission. */
export function useMissionMarker(store: Store | null, current: Mission | null): MissionMarkerTarget | null {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!store) {
      return;
    }
    const offZones = store.subscribe((s) => s.voiceZones, bump);
    const offDesks = store.subscribe((s) => s.deskAreas, bump);
    return () => {
      offZones();
      offDesks();
    };
  }, [store]);
  const state = store?.getState();
  const zones = state?.voiceZones;
  const desks = state?.deskAreas;
  return useMemo(() => {
    if (!current?.place || !zones || !desks) {
      return null;
    }
    const spot = resolvePlace(current.place, placeAreas(zones, desks));
    return spot && { ...spot, label: `Mission: ${current.title}` };
  }, [current, zones, desks]);
}
