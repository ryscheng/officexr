import { useSyncExternalStore } from 'react';
import type { Store, WorldConstants } from '@officexr/sdk';

/** Subscribes to the store's `worldConstants`; re-renders only when the document is replaced. */
export function useWorldConstants(store: Store): WorldConstants {
  return useSyncExternalStore(
    (onChange) => store.subscribe((s) => s.worldConstants, onChange),
    () => store.getState().worldConstants,
  );
}
