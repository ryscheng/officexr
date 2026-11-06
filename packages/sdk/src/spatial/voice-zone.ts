import type { DeskAreaState, VoiceZone } from '../game-state/types.ts';

type Rect = Pick<VoiceZone, 'id' | 'min' | 'max'>;

const area = (z: Rect): number => (z.max.x - z.min.x) * (z.max.z - z.min.z);

/** Zone containing `pos` (bounds inclusive). Overlaps resolve to the smallest area, then lowest id. */
export function voiceZoneAt<Z extends Rect = VoiceZone>(zones: readonly Z[], pos: { x: number; z: number }): Z | null {
  let best: Z | null = null;
  for (const z of zones) {
    if (pos.x < z.min.x || pos.x > z.max.x || pos.z < z.min.z || pos.z > z.max.z) {
      continue;
    }
    if (best === null || area(z) < area(best) || (area(z) === area(best) && z.id < best.id)) {
      best = z;
    }
  }
  return best;
}

/** The desk area containing `pos`, by the same overlap rule as `voiceZoneAt`. */
export const deskAreaAt = (areas: readonly DeskAreaState[], pos: { x: number; z: number }) => voiceZoneAt(areas, pos);
