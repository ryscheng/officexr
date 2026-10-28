import { createContext, useContext, useMemo } from 'react';
import type { OfficeState, Store } from '@officexr/sdk';
import { buildNavGrid, type NavGrid } from '../nav/grid.ts';
import { worldObjectsToColliders } from '../physics/rules.ts';
import { STEP_UP_MAX_HEIGHT } from '../physics/step-up.ts';
import { CHAR_HEIGHT_M } from '../renderer/config.ts';
import { useStoreWorldObjects } from '../renderer/useStoreWorldObjects.ts';
import { useApplication, useCatalog } from './application-context.tsx';
import { useStoreSelector } from './useStoreSelector.ts';

const NavGridContext = createContext<NavGrid | null>(null);

export const NavGridProvider = NavGridContext.Provider;

/** The walkability grid of the room being played; null while it has no world objects or they span too far to grid. */
export function useNavGrid(): NavGrid | null {
  return useContext(NavGridContext);
}

const selectCharRadius = (s: OfficeState) => s.worldSettings.charRadius;

/** Builds the nav grid from every world object in `store`, baked-layout instances included. */
export function useBuildNavGrid(store: Store): NavGrid | null {
  const { geometry, catalog } = useApplication();
  // `catalog` is a stable service; this snapshot changes when its kinds load or change.
  const kinds = useCatalog();
  const worldObjects = useStoreWorldObjects(store);
  const charRadius = useStoreSelector(store, selectCharRadius);
  return useMemo(() => {
    if (worldObjects.instances.length === 0) {
      return null;
    }
    const colliders = worldObjectsToColliders(
      worldObjects,
      geometry.worldAABB,
      (kindId) => catalog.getKind(kindId)?.colliderShape,
    );
    return buildNavGrid(colliders, { charRadius, charHeight: CHAR_HEIGHT_M, maxStep: STEP_UP_MAX_HEIGHT });
  }, [worldObjects, geometry, catalog, kinds, charRadius]);
}
