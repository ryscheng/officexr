import { parseSeatId, type PlayerPose } from '@officexr/sdk';
import { waterAt, type WaterVolume } from '../../motion/water.ts';

export interface OccupantState {
  seat?: string | null;
  pose?: PlayerPose | null;
  poseRack?: string | null;
  pos: { x: number; z: number };
}

export function collectOccupiedInstanceIds(
  out: Set<string>,
  player: OccupantState | undefined,
  water: readonly WaterVolume[],
): Set<string> {
  out.clear();
  if (!player) return out;
  if (player.seat) out.add(parseSeatId(player.seat).instanceId);
  if (player.poseRack) out.add(player.poseRack);
  if (player.pose === 'swim') {
    const pool = waterAt(water, player.pos.x, player.pos.z);
    if (pool) out.add(pool.id);
  }
  return out;
}
