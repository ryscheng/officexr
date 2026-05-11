import type { BotModeContext, BotModeStrategy } from './types.ts';

function intentTowardLocal(
  ctx: BotModeContext,
  sign: 1 | -1,
): { x: number; z: number } | null {
  const dx = ctx.localPlayerPos.x - ctx.botPos.x;
  const dz = ctx.localPlayerPos.z - ctx.botPos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-3) return null;
  return { x: (dx / dist) * sign, z: (dz / dist) * sign };
}

/** Steer directly at the local player's last-known position. */
export const walkToLocalStrategy: BotModeStrategy = {
  computeIntent: (ctx) => intentTowardLocal(ctx, 1),
};

/** Steer directly away from the local player's last-known position. */
export const walkAwayStrategy: BotModeStrategy = {
  computeIntent: (ctx) => intentTowardLocal(ctx, -1),
};
