import type { OfficeState, Store, WorldConstants } from '@officexr/sdk';
import { useStoreSelector } from './useStoreSelector.ts';

const selectWorldConstants = (s: OfficeState) => s.worldConstants;

export function useWorldConstants(store: Store): WorldConstants {
  return useStoreSelector(store, selectWorldConstants);
}
