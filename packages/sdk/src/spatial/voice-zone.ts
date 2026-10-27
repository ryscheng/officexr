import type { VoiceZone } from '../game-state/types.ts';

const area = (z: VoiceZone): number => (z.max.x - z.min.x) * (z.max.z - z.min.z);

/** Zone containing `pos` (bounds inclusive). Overlaps resolve to the smallest area, then lowest id. */
export function voiceZoneAt(
  zones: readonly VoiceZone[],
  pos: { x: number; z: number },
): VoiceZone | null {
  let best: VoiceZone | null = null;
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
