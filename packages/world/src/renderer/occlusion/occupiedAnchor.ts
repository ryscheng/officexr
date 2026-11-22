import type { PlayerPose } from '@officexr/sdk';
import { BODY_Y } from '../../physics/rules.ts';
import { setAnchorAt, type Anchor } from './occlusionMath.ts';

const RIDE_HEIGHT = 0.3;

export interface AnchorState {
  seat?: string | null;
  pose?: PlayerPose | null;
  pos: { x: number; y: number; z: number };
}

export function collectOccupiedAnchor(out: Anchor, player: AnchorState | undefined, charRadius: number): Anchor {
  out.active = false;
  if (!player) return out;
  const feetY = player.pos.y + BODY_Y - charRadius;
  if (player.seat) {
    setAnchorAt(out, player.pos.x, player.pos.y, player.pos.z);
  } else if (player.pose === 'swim') {
    setAnchorAt(out, player.pos.x, feetY, player.pos.z);
  } else if (player.pose === 'scooter' || player.pose === 'tricycle') {
    setAnchorAt(out, player.pos.x, feetY + RIDE_HEIGHT, player.pos.z);
  }
  return out;
}
