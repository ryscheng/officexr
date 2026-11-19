import type { PlayerId } from '@officexr/sdk';

export const POKE_REACH_M = 1.7;
export const POKE_HALF_ANGLE_RAD = (70 * Math.PI) / 180;
export const POKE_DURATION_S = 0.6;
export const POKE_COOLDOWN_S = 0.8;
export const POKE_TURN_S = 0.9;

export interface PokeActor {
  x: number;
  z: number;
  /** Store yaw: forward is (-sin, -cos). */
  yaw: number;
}

export function pickPokeTarget(
  poker: PokeActor,
  others: readonly (Pick<PokeActor, 'x' | 'z'> & { id: PlayerId })[],
): PlayerId | null {
  const fx = -Math.sin(poker.yaw);
  const fz = -Math.cos(poker.yaw);
  let best: PlayerId | null = null;
  let bestDistance = POKE_REACH_M;
  for (const other of others) {
    const dx = other.x - poker.x;
    const dz = other.z - poker.z;
    const distance = Math.hypot(dx, dz);
    if (distance > bestDistance) {
      continue;
    }
    const angle = distance < 1e-6 ? 0 : Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / distance)));
    if (angle <= POKE_HALF_ANGLE_RAD) {
      best = other.id;
      bestDistance = distance;
    }
  }
  return best;
}

export function yawToward(from: { x: number; z: number }, to: { x: number; z: number }): number {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}
