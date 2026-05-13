import { useEffect } from 'react';
import { useControls } from 'leva';
import type { Actions, Store } from '@officexr/sdk';
import { WORLD } from '../config.ts';

export interface WorldPanelValues {
  gridSize: number;
  stoneLayers: number;
}

/**
 * Leva "World" panel: floor size + stone-layer depth. The grid size is
 * mirrored into the broadcast worldMap so peers (and headless bots)
 * share the same playable area; stone layers are render-only.
 */
export function useWorldPanel(store: Store, actions: Actions): WorldPanelValues {
  const values = useControls('World', {
    gridSize: {
      value: WORLD.gridSize,
      min: 4,
      max: 100,
      step: 2,
      label: 'floor size',
    },
    stoneLayers: { value: WORLD.stoneLayers, min: 0, max: 5, step: 1 },
  });

  useEffect(() => {
    const current = store.getState().worldMap;
    if (current.gridSize === values.gridSize) return;
    actions.setWorldMap({ ...current, gridSize: values.gridSize });
  }, [actions, store, values.gridSize]);

  return values;
}
