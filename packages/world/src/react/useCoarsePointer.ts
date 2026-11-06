import { useMediaQuery } from './useMediaQuery.ts';

/** Whether the primary pointer is coarse (a touch-first device); tracks changes. */
export function useCoarsePointer(): boolean {
  return useMediaQuery('(pointer: coarse)');
}
