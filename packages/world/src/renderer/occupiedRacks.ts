import type { ObjectInstance } from '@officexr/sdk';
import type { ExcludeInstance } from './useStoreWorldObjects.ts';

/** Joined with `|` so the selector result compares by value. */
export function occupiedRacks(players: Record<string, { poseRack?: string | null }>): string {
  return Object.values(players)
    .flatMap((p) => (p.poseRack ? [p.poseRack] : []))
    .sort()
    .join('|');
}

export function excludeRacks(racksInUse: string, base: ExcludeInstance | undefined): ExcludeInstance | undefined {
  if (!racksInUse) return base;
  const empty = new Set(racksInUse.split('|'));
  return (instance: ObjectInstance) => empty.has(instance.id) || (base?.(instance) ?? false);
}
