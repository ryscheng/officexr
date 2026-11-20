import { pickSpellTarget, SPELL_RANGE_M, type SpellCast, type SpellId, type Vec3 } from '@officexr/sdk';

export const WAND_TIP_FORWARD_M = 0.55;
export const WAND_TIP_HEIGHT_M = 1.15;
const BODY_CENTRE_HEIGHT_M = 0.9;

export interface CastCaster {
  feet: Vec3;
  /** Store yaw: forward is (-sin, -cos). */
  yaw: number;
}

export function buildCast(
  spell: SpellId,
  caster: CastCaster,
  others: readonly { id: string; feet: Vec3 }[],
  distanceToWall: (origin: Vec3, dir: Vec3, maxDistance: number) => number,
): SpellCast {
  const dir = { x: -Math.sin(caster.yaw), y: 0, z: -Math.cos(caster.yaw) };
  const origin = {
    x: caster.feet.x + dir.x * WAND_TIP_FORWARD_M,
    y: caster.feet.y + WAND_TIP_HEIGHT_M,
    z: caster.feet.z + dir.z * WAND_TIP_FORWARD_M,
  };
  const wall = Math.min(SPELL_RANGE_M, Math.max(0, distanceToWall(origin, dir, SPELL_RANGE_M)));
  const hit = pickSpellTarget(
    origin,
    dir,
    others.map((o) => ({ id: o.id, x: o.feet.x, y: o.feet.y + BODY_CENTRE_HEIGHT_M, z: o.feet.z })),
    wall,
  );
  return { spell, origin, dir, distance: hit ? hit.distance : wall, targetId: hit ? hit.id : null };
}
