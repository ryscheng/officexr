import { SPELLS, travelMs, type SpellCast, type Vec3 } from '@officexr/sdk';

export interface BoltState {
  position: Vec3;
  progress: number;
  landed: boolean;
}

export const landingPoint = (cast: SpellCast): Vec3 => ({
  x: cast.origin.x + cast.dir.x * cast.distance,
  y: cast.origin.y + cast.dir.y * cast.distance,
  z: cast.origin.z + cast.dir.z * cast.distance,
});

export function boltAt(cast: SpellCast, ageMs: number): BoltState {
  const total = travelMs(cast.spell, cast.distance);
  const progress = total <= 0 ? 1 : Math.max(0, Math.min(1, ageMs / total));
  const d = cast.distance * progress;
  return {
    position: { x: cast.origin.x + cast.dir.x * d, y: cast.origin.y + cast.dir.y * d, z: cast.origin.z + cast.dir.z * d },
    progress,
    landed: progress >= 1,
  };
}

export const boltColor = (cast: SpellCast) => SPELLS[cast.spell].projectile.color;
