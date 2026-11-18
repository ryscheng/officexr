import { useMemo, type ComponentProps } from 'react';
import type { OfficeState, Store } from '@officexr/sdk';
import { useApplication, useCatalog, useStoreSelector } from '@officexr/world/top-down';
import { buildPlan, type PlanRect } from './minimapPlan';
import { Minimap } from './Minimap';

const selectObjects = (s: OfficeState) => s.worldObjects;

/** The map's placed objects as a floor plan, rebuilt when the objects or the catalog change. */
export function useMapPlan(store: Store): readonly PlanRect[] {
  const objects = useStoreSelector(store, selectObjects);
  const { geometry, catalog } = useApplication();
  const kinds = useCatalog();
  return useMemo(
    () => buildPlan(objects.instances, (i) => geometry.worldAABBOfInstance(i), (id) => catalog.getKind(id)),
    // `kinds` changes when the catalog loads, which changes what `catalog.getKind` returns.
    [objects, geometry, catalog, kinds],
  );
}

/** The minimap with the office's floor plan drawn under the people; needs the app's catalog. */
export function OfficeMinimap(props: Omit<ComponentProps<typeof Minimap>, 'plan'>) {
  return <Minimap {...props} plan={useMapPlan(props.store)} />;
}
